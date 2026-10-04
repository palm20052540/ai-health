// Bind legacy browser preferences to the first verified owner. Keep originals intact;
// another verified owner only sees their own namespaced values.
export function ownerStorage(owner, storage = globalThis.localStorage) {
  if (typeof owner !== "string" || !owner) throw new Error("Verified owner required");
  const marker = "tong-fit:legacy-preference-owner:v1";
  let legacy = false;
  try { if (!storage?.getItem(marker)) storage?.setItem(marker, owner); legacy = storage?.getItem(marker) === owner; } catch { /* No legacy fallback without a confirmed binding. */ }
  return {
    getItem(key) { try { return storage?.getItem(`${key}:owner:${owner}`) ?? (legacy ? storage?.getItem(key) : null); } catch { return null; } },
    setItem(key, value) { if (!storage) throw new Error("Browser storage unavailable"); storage.setItem(`${key}:owner:${owner}`, value); },
  };
}
