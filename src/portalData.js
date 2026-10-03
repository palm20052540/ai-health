const RANGE_DAYS = { "7D": 7, "30D": 30, "3M": 90, "6M": 180, "1Y": 365 };

export function daysForRange(range) {
  return RANGE_DAYS[range] || 30;
}

async function request(path, init = {}) {
  const response = await fetch(path, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
  return body;
}

export function fetchDashboard(days, signal) {
  return request(`/api/dashboard?days=${days}`, { signal });
}

export function fetchCoach(snapshot, signal) {
  return request("/api/coach", { method: "POST", signal, body: JSON.stringify({ snapshot }) });
}

export function syncDashboard() {
  return request("/api/sync", {
    method: "POST",
    body: JSON.stringify({ sources: ["hevy", "google_health"] }),
  });
}

export function fetchRoutines() {
  return request("/api/routines");
}

export function fetchRoutine(routineId) {
  return request(`/api/routines/${encodeURIComponent(routineId)}`);
}

export function writeRoutine({ action, routineId, routine, idempotencyKey }) {
  const creating = action === "create";
  return request(creating ? "/api/routines" : `/api/routines/${encodeURIComponent(routineId)}`, {
    method: creating ? "POST" : "PUT",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ routine }),
  });
}

export function syncMessage(payload) {
  const results = payload?.results || {};
  const entries = Object.entries(results);
  if (!entries.length) return "No data sources were checked.";
  const synced = entries.filter(([, result]) => result?.status === "synced").map(([source]) => source);
  const current = entries.filter(([, result]) => result?.status === "fresh").map(([source]) => source);
  const pending = entries.filter(([, result]) => result?.status === "sync_in_progress").map(([source]) => source);
  const cooldown = entries.filter(([, result]) => result?.status === "cooldown_active").map(([source]) => source);
  const failed = entries.filter(([, result]) => result?.status === "partial_failure").map(([source]) => source);
  const parts = [];
  if (synced.length) parts.push(`${synced.join(" and ")} updated`);
  if (current.length) parts.push(`${current.join(" and ")} already current`);
  if (pending.length) parts.push(`${pending.join(" and ")} sync is still in progress; new data is not confirmed yet`);
  if (cooldown.length) parts.push(`${cooldown.join(" and ")} is in a refresh cooldown; a new sync was not run`);
  if (failed.length) parts.push(`${failed.join(" and ")} could not update`);
  return `${parts.join("; ") || "Freshness check completed"}.`;
}

export function formatGeneratedAt(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "Not synced yet";
  return new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Bangkok", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(new Date(value));
}

export function isSamplePayload(payload) {
  return Boolean(payload && (payload.sample || payload.demo || payload.is_sample || ['sample', 'demo'].includes(payload.mode) || ['sample', 'demo'].includes(payload.data_state)));
}

export function dashboardDataState(payload, loadState = {}) {
  if (isSamplePayload(payload)) return 'sample';
  if (!payload) return loadState.status || 'missing';
  if (!payload.recap || !Number.isFinite(Date.parse(payload.generated_at || ''))) return 'missing';
  return loadState.error ? 'stale' : 'live';
}
