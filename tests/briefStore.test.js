import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readReportInput, readSavedReport, saveReport } from "../worker/briefStore.js";
import { BRIEF_TOOLS, briefPrincipal, handleBriefMcp } from "../worker/briefMcp.js";

const NOW = Date.now();
const ISO = new Date(NOW - 1000).toISOString();
function fixture() {
  const metric = { recorded_at: ISO, synced_at: ISO };
  return { generated_at: ISO, recap: {
    period: { days: 28 },
    summary: { sleep: { asleep_minutes: { count: 14, latest: 430, average: 425 } }, recovery: { hrv_ms: { count: 14, latest: 55, average: 54 }, resting_heart_rate_bpm: { count: 14, latest: 60, average: 61 } }, activity: { steps: { count: 0, latest: null, average: null } }, training: {} },
    freshness: { google_health: { sleep: metric, "daily-heart-rate-variability": metric, "daily-resting-heart-rate": metric } },
  } };
}
const databases = [];
function store() {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  db.exec("CREATE TABLE assistant_briefs (owner_id TEXT NOT NULL, kind TEXT NOT NULL, source_hash TEXT NOT NULL, source_at TEXT, generated_at INTEGER NOT NULL, version TEXT NOT NULL, report_json TEXT NOT NULL, PRIMARY KEY(owner_id,kind))");
  return { prepare(sql) { return { bind(...args) { return { first: async () => db.prepare(sql).get(...args) || null, run: async () => db.prepare(sql).run(...args) }; } }; } };
}
after(() => { for (const db of databases) db.close(); });
const env = () => ({ BRIEF_DB: store(), ALLOWED_USER_EMAIL: "owner@example.test" });

test("private store saves a validated report, reads it back, and keeps replay timestamp", async () => {
  const config = env(); const read = async () => fixture();
  const input = await readReportInput("daily", read, NOW);
  assert.equal(input.dataState, "live");
  const args = { kind: "daily", sourceHash: input.sourceHash, report: input.draft };
  const saved = await saveReport(config, "owner-1", args, read, NOW);
  assert.equal(saved.status, "ready"); assert.deepEqual(saved.report, input.draft);
  const repeated = await saveReport(config, "owner-1", args, read, NOW + 10000);
  assert.equal(repeated.generatedAt, saved.generatedAt);
  assert.equal((await readSavedReport(config, "another-owner", "daily", read, NOW)).status, "missing");
});

test("changed source hash rejects old write and removes active narrative from read", async () => {
  const config = env(); let payload = fixture(); const read = async () => payload;
  const input = await readReportInput("daily", read, NOW);
  await saveReport(config, "owner", { kind: "daily", sourceHash: input.sourceHash, report: input.draft }, read, NOW);
  payload = structuredClone(payload); payload.recap.summary.sleep.asleep_minutes.latest = 350;
  await assert.rejects(saveReport(config, "owner", { kind: "daily", sourceHash: input.sourceHash, report: input.draft }, read, NOW), { status: 409 });
  const stale = await readSavedReport(config, "owner", "daily", read, NOW);
  assert.equal(stale.status, "stale"); assert.equal(stale.report, null);
});

test("sample inputs, unsupported output, missing database and invalid kind fail safely", async () => {
  const config = env(); const read = async () => fixture(); const input = await readReportInput("daily", read, NOW);
  await assert.rejects(saveReport(config, "owner", { kind: "daily", sourceHash: input.sourceHash, report: { ...input.draft, narrative: "You are certainly healthy and cleared for exercise." } }, read, NOW));
  const sampleRead = async () => ({ ...fixture(), sample: true });
  assert.equal((await readSavedReport(config, "owner", "daily", sampleRead, NOW)).report, null);
  await assert.rejects(saveReport(config, "owner", { kind: "daily", sourceHash: input.sourceHash, report: input.draft }, sampleRead, NOW), { status: 409 });
  await assert.rejects(readSavedReport({}, "owner", "daily", read, NOW), { status: 503 });
  await assert.rejects(readReportInput("arbitrary-table", read, NOW), { status: 400 });
});

function request(method, params, identity = true, moreHeaders = {}) {
  return new Request("https://site.example/mcp", { method: "POST", headers: { "Content-Type": "application/json", ...(identity ? { "oai-authenticated-user-email": "owner@example.test", "oai-authenticated-user-id": "owner" } : {}), ...moreHeaders }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
}
test("MCP discovery is private-data-free while tool calls require both owner identity headers", async () => {
  const config = env(); let sourceReads = 0;
  const deps = { readDashboard: async () => { sourceReads++; return fixture(); } };
  const discovery = await handleBriefMcp(request("tools/list", {}, false), config, deps);
  assert.equal(discovery.status, 200); assert.equal(sourceReads, 0);
  assert.deepEqual((await discovery.json()).result.tools, BRIEF_TOOLS);
  const denied = await handleBriefMcp(request("tools/call", { name: "get_brief_input", arguments: { kind: "daily" } }, false), config, deps);
  assert.equal(denied.status, 401); assert.equal(sourceReads, 0);
  const other = await handleBriefMcp(request("tools/call", { name: "get_brief_input", arguments: { kind: "daily" } }, true, { "oai-authenticated-user-email": "someone@example.test" }), config, deps);
  assert.equal(other.status, 403); assert.equal(sourceReads, 0);
  assert.throws(() => briefPrincipal(request("ping"), {}), { status: 503 });
});

test("MCP read/save/readback flow and strict arguments work without inference", async () => {
  const config = env(); const deps = { readDashboard: async () => fixture() };
  const call = async (name, args) => (await (await handleBriefMcp(request("tools/call", { name, arguments: args }), config, deps)).json());
  const input = (await call("get_brief_input", { kind: "daily" })).result.structuredContent;
  const saved = await call("save_brief", { kind: "daily", sourceHash: input.sourceHash, report: input.draft });
  assert.equal(saved.result.structuredContent.status, "ready");
  const checked = await call("get_saved_brief", { kind: "daily" });
  assert.equal(checked.result.structuredContent.status, "ready");
  assert.equal((await call("get_brief_input", { kind: "daily", ownerId: "spoof" })).error.code, -32602);
  const crossOrigin = await handleBriefMcp(request("tools/list", {}, true, { origin: "https://untrusted.example" }), config, deps);
  assert.equal(crossOrigin.status, 403);
  const event = await (await handleBriefMcp(request("events/subscribe", {}), config, deps)).json();
  assert.equal(event.error.code, -32601);
});
