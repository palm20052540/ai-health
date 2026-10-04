import { readBoundedJson } from "./dailyBrief.js";
import { readReportInput, readSavedReport, saveReport } from "./briefStore.js";
import { TRAINING_EVENT, subscribeTraining, unsubscribeTraining } from "./briefEvents.js";

const headers = { "Content-Type": "application/json", "Cache-Control": "private, no-store" };
const kindSchema = { type: "string", enum: ["daily", "training"] };
const kindInput = { type: "object", properties: { kind: kindSchema }, required: ["kind"], additionalProperties: false };
const annotations = (readOnly) => ({ readOnlyHint: readOnly, destructiveHint: false, idempotentHint: true, openWorldHint: false });

export const BRIEF_TOOLS = [
  {
    name: "get_brief_input", title: "Read current brief evidence",
    description: "Read the owner's current fixed 28-day evidence and a conservative evidence-engine draft. daily is the Health Daily Brief plus morning Recovery context; training is the latest session review. Generate the requested report in this assistant conversation without an external model API. Copy all IDs, titles, ratings, evidence and uncertainty exactly; only tighten narrative and supported summaries. Rephrased prose must omit numerical claims; numbers remain in immutable evidence. Keep insufficient-comparison summaries unchanged. Never invent evidence, clear exercise, prescribe loads, or include medical advice. If dataState is not live, do not save a report. Pass sourceHash unchanged to save_brief. Local pain/fatigue inputs and profile are not part of this snapshot.",
    inputSchema: kindInput, annotations: annotations(true),
  },
  {
    name: "save_brief", title: "Save a generated Tong Fit brief",
    description: "Save the assistant-generated report privately for the signed-in owner. Re-reads current source data and rejects an outdated sourceHash or invalid report. Return value is a verified read-back; only status ready means current. Use the exact draft shape from get_brief_input. No source workout or health record is changed. Repeated identical writes keep the original generation time.",
    inputSchema: { type: "object", properties: { kind: kindSchema, sourceHash: { type: "string", pattern: "^[a-f0-9]{64}$" }, report: { type: "object" } }, required: ["kind", "sourceHash", "report"], additionalProperties: false },
    annotations: annotations(false),
  },
  {
    name: "get_saved_brief", title: "Check the saved Tong Fit brief",
    description: "Read the owner's saved report and verify it against current source evidence. Missing, stale or unavailable reports do not include an active narrative. This does not trigger inference or schedule updates.",
    inputSchema: kindInput, annotations: annotations(true),
  },
  {
    name: "refresh_daily_sources", title: "Refresh morning health source data",
    description: "Run the owner's existing Google Health freshness/sync pipeline before the requested morning Health and Recovery summary. This refreshes cached source measurements, not medical or workout source records. Inspect returned status; an in-progress, failed or partial refresh is not a completed fresh sync. Then call get_brief_input and use its source timestamps honestly.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: annotations(false),
  },
];

export function briefPrincipal(request, env) {
  const allowed = typeof env.ALLOWED_USER_EMAIL === "string" ? env.ALLOWED_USER_EMAIL.trim().toLowerCase() : "";
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  const id = request.headers.get("oai-authenticated-user-id");
  if (!allowed) throw Object.assign(new Error("Owner authorization is not configured."), { status: 503 });
  if (!email || !id) throw Object.assign(new Error("Connect the owner's Tong Fit plugin to use private summaries."), { status: 401 });
  if (email !== allowed) throw Object.assign(new Error("Forbidden"), { status: 403 });
  return id;
}

function response(body, status = 200) { return new Response(JSON.stringify(body), { status, headers }); }
function rpcError(id, code, message, status = 200, data) { return response({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } }, status); }
function exactArguments(args, keys) { return args && typeof args === "object" && !Array.isArray(args) && Object.keys(args).length === keys.length && keys.every((key) => Object.hasOwn(args, key)); }

export async function handleBriefMcp(request, env, dependencies) {
  if (request.method !== "POST") return response({ error: "Use POST for MCP requests." }, 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return response({ error: "Cross-origin browser requests are not allowed." }, 403);
  let body;
  try { body = await readBoundedJson(request, 64000); }
  catch { return rpcError(null, -32700, "Invalid JSON request.", 400); }
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(body.id, -32600, "Invalid MCP request.", 400);
  if (body.method === "notifications/initialized") return new Response(null, { status: 202, headers });
  const modern = body.method === "server/discover" || body.params?._meta?.["io.modelcontextprotocol/protocolVersion"] === "2026-07-28";
  const ok = (result) => response({ jsonrpc: "2.0", id: body.id ?? null, result: { ...(modern ? { resultType: "complete" } : {}), ...result } });
  const cacheHints = modern ? { ttlMs: 0, cacheScope: "private" } : {};
  // Discovery contains no private source data; Sites still enforces its private boundary.
  if (body.method === "server/discover") return ok({ ...cacheHints, supportedVersions: ["2026-07-28"], capabilities: { tools: {}, events: {} } });
  if (body.method === "initialize") return ok({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "tong-fit-private-briefs", version: "1.0.0" } });
  if (body.method === "ping") return ok({});
  if (body.method === "tools/list") return ok({ ...cacheHints, tools: BRIEF_TOOLS });
  if (body.method === "events/list") return ok({ events: [TRAINING_EVENT] });
  if (!["tools/call", "events/subscribe", "events/unsubscribe"].includes(body.method)) return rpcError(body.id, -32601, "Method not available.");
  let ownerId;
  try { ownerId = briefPrincipal(request, env); }
  catch (error) { return rpcError(body.id, -32001, error.message, error.status); }
  if (body.method.startsWith("events/")) {
    try {
      return ok(body.method === "events/subscribe" ? await subscribeTraining(env, ownerId, body.params, dependencies.sendWebhook) : await unsubscribeTraining(env, ownerId, body.params));
    } catch (error) {
      return rpcError(body.id, error?.rpcCode || -32603, error?.rpcCode ? error.message : "The subscription operation could not complete.", 200, { reason: error?.reason || "internal_error" });
    }
  }
  const name = body.params?.name;
  const args = body.params?.arguments || {};
  const tool = BRIEF_TOOLS.find((candidate) => candidate.name === name);
  if (!tool) return rpcError(body.id, -32602, "Unknown tool.");
  const keys = name === "save_brief" ? ["kind", "sourceHash", "report"] : name === "refresh_daily_sources" ? [] : ["kind"];
  if (!exactArguments(args, keys)) return rpcError(body.id, -32602, "Unexpected or missing arguments.");
  try {
    let result;
    if (name === "get_brief_input") result = await readReportInput(args.kind, dependencies.readDashboard);
    else if (name === "get_saved_brief") result = await readSavedReport(env, ownerId, args.kind, dependencies.readDashboard);
    else if (name === "save_brief") result = await saveReport(env, ownerId, args, dependencies.readDashboard);
    else result = await dependencies.refreshDailySources();
    return ok({ content: [{ type: "text", text: JSON.stringify(result) }], structuredContent: result, isError: false });
  } catch (error) {
    // No request bodies, source records, tokens or database diagnostics enter logs/errors.
    const message = [400, 409, 503].includes(error?.status) ? error.message : "The brief operation could not be completed. Source data or storage may be unavailable, or the report did not pass validation.";
    return ok({ content: [{ type: "text", text: message }], isError: true });
  }
}
