import { isSamplePayload } from "./portalData.js";

export const DASHBOARD_CACHE_KEY = "tong-fit:private-snapshots:v1";
export const FRESH_CACHE_MS = 60000;
export const MAX_CACHE_MS = 600000;
const DAYS = [7, 28, 30, 90, 180, 365];
const MAX_BYTES = 1500000;
const KEYS = ["schema_version", "generated_at", "timezone", "period", "recap", "exercise_progress", "recent_workouts", "body_measurements"];
const validPayload = (value) => value && !isSamplePayload(value) && value.recap && Number.isFinite(Date.parse(value.generated_at || ""));
const invalidated = () => Object.assign(new Error("Snapshot request superseded."), { cancelled: true });

// This tab's private cache is inaccessible to callers until a current server identity
// check activates its owner. Never use localStorage, the HTTP cache, or a public CDN.
export function createDashboardCache({ fetcher, storage, now = Date.now, onChange = () => {}, onAuthFailure = () => {} }) {
  let owner = null, epoch = 0;
  const entries = new Map(), pending = new Map(), states = new Map();
  const removeStored = () => { try { storage?.removeItem(DASHBOARD_CACHE_KEY); } catch { /* Optional browser storage. */ } };
  const persist = () => {
    try {
      const persisted = [...entries].sort((a, b) => b[1].storedAt - a[1].storedAt);
      while (persisted.length && JSON.stringify(persisted).length > MAX_BYTES) persisted.pop();
      if (owner) storage?.setItem(DASHBOARD_CACHE_KEY, JSON.stringify({ version: 1, owner, entries: persisted }));
    } catch { removeStored(); }
  };
  const read = (days) => {
    if (!owner) return { status: "locked", payload: null };
    const entry = entries.get(days), age = entry ? now() - entry.storedAt : null;
    if (entry && (age < 0 || age >= MAX_CACHE_MS)) { entries.delete(days); persist(); }
    const item = entries.get(days), state = states.get(days) || {};
    return { payload: item?.payload || null, storedAt: item?.storedAt || null, ageMs: item ? age : null, refreshing: pending.has(days), error: state.error || null,
      status: item ? state.error || age >= FRESH_CACHE_MS || item.restored ? "stale" : state.network ? "live" : "cached" : state.status || "loading" };
  };
  const clear = () => {
    epoch++; for (const task of pending.values()) task.controller.abort();
    pending.clear(); entries.clear(); states.clear(); removeStored(); onChange();
  };
  return {
    activate(nextOwner) {
      if (typeof nextOwner !== "string" || !nextOwner.trim()) throw new Error("Verified owner is required.");
      if (owner === nextOwner) return;
      epoch++; entries.clear(); states.clear(); for (const task of pending.values()) task.controller.abort(); pending.clear(); owner = nextOwner;
      try {
        const raw = storage?.getItem(DASHBOARD_CACHE_KEY);
        const saved = raw && raw.length <= MAX_BYTES + 1000 ? JSON.parse(raw) : null;
        if (saved?.version === 1 && saved.owner === owner && Array.isArray(saved.entries)) {
          for (const [days, entry] of saved.entries.slice(0, DAYS.length)) {
            const age = now() - entry?.storedAt;
            if (DAYS.includes(days) && validPayload(entry?.payload) && age >= 0 && age < MAX_CACHE_MS) entries.set(days, { ...entry, restored: true });
          }
        } else removeStored();
      } catch { removeStored(); }
      onChange();
    },
    read,
    invalidate: clear,
    markUnavailable(message) { clear(); for (const days of DAYS) states.set(days, { status: "unavailable", error: message }); onChange(); },
    lock() { clear(); owner = null; },
    load(days, { force = false } = {}) {
      if (!owner || !DAYS.includes(days)) return Promise.reject(new Error("Private snapshot is unavailable."));
      if (pending.has(days)) return pending.get(days).promise;
      const previous = read(days);
      if (!force && previous.payload && previous.ageMs < FRESH_CACHE_MS && previous.status !== "stale") { states.set(days, { network: false }); onChange(); return Promise.resolve(previous.payload); }
      const generation = epoch, controller = new AbortController();
      states.set(days, { status: "loading", error: null });
      const promise = Promise.resolve().then(() => fetcher(days, controller.signal)).then((payload) => {
        if (generation !== epoch) throw invalidated();
        if (isSamplePayload(payload)) { entries.delete(days); states.set(days, { status: "sample" }); persist(); return payload; }
        if (!validPayload(payload)) throw new Error("Source snapshot is invalid.");
        const clean = Object.fromEntries(KEYS.filter((key) => Object.hasOwn(payload, key)).map((key) => [key, payload[key]]));
        if (JSON.stringify(clean).length > 20000000) throw new Error("Source snapshot exceeds this browser’s safe cache limit.");
        entries.set(days, { payload: clean, storedAt: now(), restored: false });
        while (JSON.stringify([...entries]).length > 20000000 && entries.size > 1) {
          const oldest = [...entries].filter(([key]) => key !== days).sort((a, b) => a[1].storedAt - b[1].storedAt)[0][0]; entries.delete(oldest);
        }
        states.set(days, { network: true }); persist();
        return clean;
      }).catch((error) => {
        if (generation !== epoch) throw invalidated();
        if ([401, 403].includes(error?.status)) { clear(); owner = null; onAuthFailure(); }
        else states.set(days, { status: "unavailable", error: error?.message || "Data connection unavailable" });
        throw error;
      }).finally(() => { if (generation === epoch) { pending.delete(days); onChange(); } });
      pending.set(days, { promise, controller }); onChange(); return promise;
    },
  };
}
