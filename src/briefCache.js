const TTL = 30000;
let owner = null, generation = 0;
const entries = new Map(), pending = new Map();
export function clearSavedBriefCache() {
  generation++; entries.clear();
  for (const item of pending.values()) item.controller.abort();
  pending.clear();
}
export function setBriefCacheOwner(value) {
  if (owner !== value) { clearSavedBriefCache(); owner = value; }
}
export function cachedBrief(kind, fetcher, now = Date.now) {
  if (!owner) return fetcher(kind); // No persistence; the server still checks identity.
  const entry = entries.get(kind), age = entry ? now() - entry.checkedAt : Infinity;
  if (age >= 0 && age < TTL) return Promise.resolve({ ...entry.brief, cacheCheckedAt: entry.checkedAt, cacheHit: true });
  if (pending.has(kind)) return pending.get(kind).promise;
  const epoch = generation, controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  const promise = Promise.resolve().then(() => fetcher(kind, controller.signal)).then((brief) => {
    if (generation !== epoch) throw Object.assign(new Error("Summary request superseded."), { cancelled: true });
    entries.set(kind, { brief, checkedAt: now() });
    return { ...brief, cacheCheckedAt: now(), cacheHit: false };
  }).finally(() => { clearTimeout(timer); if (generation === epoch) pending.delete(kind); });
  pending.set(kind, { controller, promise }); return promise;
}
export function briefCacheExpired(brief, now = Date.now()) {
  return brief?.cacheCheckedAt != null && (now - brief.cacheCheckedAt >= TTL || now < brief.cacheCheckedAt);
}
