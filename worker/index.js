import { generateHealthBrief, readBoundedJson, toLegacyCoach } from "./dailyBrief.js";
import { briefPrincipal, handleBriefMcp } from "./briefMcp.js";
import { readSavedReport } from "./briefStore.js";
import { deliverTrainingSync } from "./briefEvents.js";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function requireConfig(env) {
  if (!env.AI_HEALTH_API_URL || !env.AI_HEALTH_PLUGIN_API_KEY) {
    throw new Error("AI Health API configuration is missing");
  }
}

function authorizeSiteVisitor(request, env) {
  if (!env.ALLOWED_USER_EMAIL) return true;
  const email = request.headers.get("oai-authenticated-user-email");
  return email?.toLowerCase() === env.ALLOWED_USER_EMAIL.toLowerCase();
}

async function serveApp(request, env) {
  const response = await env.ASSETS.fetch(request);
  const acceptsHtml = request.headers.get("accept")?.includes("text/html");
  if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;

  const indexUrl = new URL(request.url);
  indexUrl.pathname = "/index.html";
  indexUrl.search = "";
  return env.ASSETS.fetch(new Request(indexUrl, request));
}

async function upstream(env, path, init = {}) {
  const base = env.AI_HEALTH_API_URL.replace(/\/$/, "");
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.AI_HEALTH_PLUGIN_API_KEY}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 402) throw new Error("Supabase usage limit reached; live data will resume when service is restored");
    throw Object.assign(new Error(payload?.error || payload?.message || `Health API returned ${response.status}`), { status: response.status });
  }
  return payload;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const readDashboard = (days) => { requireConfig(env); return upstream(env, `/v1/portal-dashboard?days=${days}`); };
    const sendWebhook = (payload) => { requireConfig(env); return upstream(env, "/v1/mcp-event-delivery", { method: "POST", body: JSON.stringify(payload) }); };
    if (url.pathname === "/mcp") return handleBriefMcp(request, env, {
      readDashboard,
      sendWebhook,
      refreshDailySources: async () => {
        requireConfig(env);
        const refreshed = await upstream(env, "/v1/sync-missing-data", { method: "POST", body: JSON.stringify({ sources: ["google_health"] }) });
        return { source: "google_health", status: refreshed?.results?.google_health?.status || "unknown", checkedAt: new Date().toISOString(), message: "Read current brief evidence next. In-progress or failed sync is not a fresh completed update." };
      },
    });
    if (!url.pathname.startsWith("/api/")) return serveApp(request, env);
    if (!authorizeSiteVisitor(request, env)) return json({ error: "Forbidden" }, 403);

    try {
      // Every data request must retain the current trusted owner identity.
      if (request.method === "GET" && url.pathname === "/api/session") return json({ ownerId: briefPrincipal(request, env) });
      if (request.method === "GET" && url.pathname === "/api/assistant-briefs") {
        return json(await readSavedReport(env, briefPrincipal(request, env), url.searchParams.get("kind"), readDashboard));
      }
      if (request.method === "POST" && ["/api/health-brief", "/api/coach"].includes(url.pathname)) {
        const body = await readBoundedJson(request);
        // Legacy clients receive rules only. This Site never makes paid model calls.
        const result = await generateHealthBrief({}, body.snapshot);
        return json(url.pathname === "/api/coach" ? toLegacyCoach(result) : result);
      }
      const healthRoutes = ["/api/dashboard", "/api/sync", "/api/status", "/api/routines"];
      if (healthRoutes.includes(url.pathname) || url.pathname.startsWith("/api/routines/")) { briefPrincipal(request, env); requireConfig(env); }
      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        const requestedDays = Number(url.searchParams.get("days") || 30);
        const days = Math.min(Math.max(Number.isFinite(requestedDays) ? requestedDays : 30, 1), 365);
        return json(await upstream(env, `/v1/portal-dashboard?days=${days}`));
      }
      if (request.method === "POST" && url.pathname === "/api/sync") {
        const origin = request.headers.get("origin");
        if (origin && origin !== url.origin) return json({ error: "Cross-origin requests are not allowed." }, 403);
        const body = await request.json().catch(() => ({}));
        const sources = Array.isArray(body.sources) ? body.sources : ["hevy", "google_health"];
        const result = await upstream(env, "/v1/sync-missing-data", {
          method: "POST",
          body: JSON.stringify({ sources }),
        });
        let assistantAnalysis;
        try { assistantAnalysis = await deliverTrainingSync(env, briefPrincipal(request, env), result, { readDashboard, sendWebhook }); }
        catch { assistantAnalysis = { status: "unavailable", message: "Source sync completed its request, but the private Training event could not be delivered. No completed analysis is claimed." }; }
        return json({ ...result, assistant_analysis: assistantAnalysis });
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        return json(await upstream(env, "/v1/data-freshness"));
      }
      if (request.method === "GET" && url.pathname === "/api/routines") {
        return json(await upstream(env, "/routines"));
      }
      const routineMatch = url.pathname.match(/^\/api\/routines\/([^/]+)$/);
      if (request.method === "GET" && routineMatch) {
        return json(await upstream(env, `/routines/${encodeURIComponent(decodeURIComponent(routineMatch[1]))}`));
      }
      if (request.method === "POST" && url.pathname === "/api/routines") {
        const body = await request.json();
        return json(await upstream(env, "/routines", {
          method: "POST",
          headers: { "Idempotency-Key": request.headers.get("Idempotency-Key") || crypto.randomUUID() },
          body: JSON.stringify(body),
        }));
      }
      if (request.method === "PUT" && routineMatch) {
        const body = await request.json();
        return json(await upstream(env, `/routines/${encodeURIComponent(decodeURIComponent(routineMatch[1]))}`, {
          method: "PUT",
          headers: { "Idempotency-Key": request.headers.get("Idempotency-Key") || crypto.randomUUID() },
          body: JSON.stringify(body),
        }));
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      return json({ error: message }, [400, 401, 403, 409, 413, 503].includes(error?.status) ? error.status : message.includes("configuration") ? 503 : 502);
    }
  },
};
