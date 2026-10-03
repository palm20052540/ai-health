const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function requireConfig(env) {
  if (!env.AI_HEALTH_API_URL || !env.AI_HEALTH_PLUGIN_API_KEY) {
    throw new Error("AI Health API configuration is missing");
  }
}

function responseText(payload) {
  return (payload?.output || []).flatMap((item) => item?.content || []).map((item) => item?.text || "").join("\n").trim();
}

function parseCoachJson(text) {
  const cleaned = String(text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const parsed = JSON.parse(cleaned);
  if (!parsed?.headline || !parsed?.summary || !parsed?.action?.title || !Array.isArray(parsed?.priorities)) {
    throw new Error("Coach response did not match the expected format");
  }
  return parsed;
}

async function generateCoach(env, snapshot) {
  if (!env.OPENAI_API_KEY) return { configured: false, mode: "rules" };
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5",
      store: false,
      max_output_tokens: 900,
      instructions: "You are Tong Fit, a concise evidence-based wellness and strength coach. Use only the supplied aggregated data. Do not diagnose, treat, or claim medical certainty. Separate observation from inference, include confidence, and give one safe actionable next step. Return valid JSON only.",
      input: `Create an adaptive coaching brief from this aggregate snapshot:\n${JSON.stringify(snapshot)}\n\nReturn exactly: {"headline":"...","summary":"...","action":{"title":"...","prescription":"...","reason":"...","confidence":"Low|Medium|High"},"priorities":[{"area":"Training|Recovery|Health","title":"...","detail":"...","tone":"blue|orange","icon":"training|recovery|health"}]}`,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message || `OpenAI returned ${response.status}`);
  return { configured: true, mode: "model", coach: parseCoachJson(responseText(payload)) };
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
    throw new Error(payload?.error || payload?.message || `Health API returned ${response.status}`);
  }
  return payload;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return serveApp(request, env);
    if (!authorizeSiteVisitor(request, env)) return json({ error: "Forbidden" }, 403);

    try {
      requireConfig(env);
      if (request.method === "GET" && url.pathname === "/api/dashboard") {
        const requestedDays = Number(url.searchParams.get("days") || 30);
        const days = Math.min(Math.max(Number.isFinite(requestedDays) ? requestedDays : 30, 1), 365);
        return json(await upstream(env, `/v1/portal-dashboard?days=${days}`));
      }
      if (request.method === "POST" && url.pathname === "/api/sync") {
        const body = await request.json().catch(() => ({}));
        const sources = Array.isArray(body.sources) ? body.sources : ["hevy", "google_health"];
        return json(await upstream(env, "/v1/sync-missing-data", {
          method: "POST",
          body: JSON.stringify({ sources }),
        }));
      }
      if (request.method === "GET" && url.pathname === "/api/status") {
        return json(await upstream(env, "/v1/data-freshness"));
      }
      if (request.method === "POST" && url.pathname === "/api/coach") {
        const body = await request.json().catch(() => ({}));
        return json(await generateCoach(env, body.snapshot || {}));
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
      return json({ error: message }, message.includes("configuration") ? 503 : 502);
    }
  },
};
