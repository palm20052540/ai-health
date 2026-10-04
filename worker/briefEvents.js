import { readReportInput } from "./briefStore.js";

export const TRAINING_EVENT_NAME = "training.sync_completed";
export const TRAINING_EVENT = {
  name: TRAINING_EVENT_NAME,
  description: "The signed-in owner pressed Sync, Hevy reported a completed/current sync, and current training evidence was read successfully. Read get_brief_input(kind=training), generate a conservative review, then save_brief against the latest hash. Delivery is asynchronous; it is not proof that analysis completed. Contains no health measurements.",
  delivery: ["webhook"],
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  payloadSchema: { type: "object", properties: { kind: { type: "string", const: "training" }, source_hash: { type: "string", pattern: "^[a-f0-9]{64}$" } }, required: ["kind", "source_hash"], additionalProperties: false },
};
const DAY = 86400000;
const VERIFY_CACHE = 5 * 60000;
const MAX_SUBSCRIPTIONS = 4;
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const error = (message, code = -32602, reason = "invalid_request") => Object.assign(new Error(message), { rpcCode: code, reason });
async function hash(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function dbFor(env) {
  if (!env.BRIEF_DB?.prepare) throw error("Private subscription storage is unavailable.", -32603, "storage_unavailable");
  return env.BRIEF_DB;
}
function callbackUrl(value) {
  if (typeof value !== "string" || value.length > 2048) throw error("Invalid callback URL.");
  let url; try { url = new URL(value); } catch { throw error("Invalid callback URL."); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443") throw error("A secure HTTPS callback is required.");
  // DNS/public-address validation and IP-pinned TLS occur at every connection in
  // the existing backend's bounded secure sender, not a racy Worker fetch check.
  return url.href;
}
function signingSecret(value) {
  if (typeof value !== "string" || !/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(value)) throw error("Invalid signing secret.");
  let decoded; try { decoded = atob(value.slice(6)); } catch { throw error("Invalid signing secret."); }
  if (decoded.length < 24 || decoded.length > 64) throw error("Invalid signing secret.");
  return value;
}
function subscriptionParameters(params, subscribe) {
  if (!object(params) || Object.keys(params).some((key) => !["name", "arguments", "delivery", "cursor", "ttlMs", "_meta"].includes(key)) || params.name !== TRAINING_EVENT_NAME || !exact(params.arguments, []) || params.cursor != null) throw error("Unsupported event or arguments.");
  // MCP request metadata is transport context, never event arguments or identity.
  // Keep extension metadata compatible without persisting or forwarding it.
  if (Object.hasOwn(params, "_meta") && !object(params._meta)) throw error("Invalid request metadata.");
  const fields = subscribe ? ["mode", "url", "secret"] : ["mode", "url"];
  if (!exact(params.delivery, fields) || params.delivery.mode !== "webhook") throw error("Webhook delivery is required.");
  const url = callbackUrl(params.delivery.url);
  return { url, secret: subscribe ? signingSecret(params.delivery.secret) : null };
}
export async function subscribeTraining(env, ownerId, params, sendWebhook, now = Date.now()) {
  const { url, secret } = subscriptionParameters(params, true);
  if (params.ttlMs != null && (!Number.isFinite(params.ttlMs) || params.ttlMs <= 0)) throw error("Invalid subscription lifetime.");
  const ttl = params.ttlMs == null ? DAY : Math.max(60000, Math.min(params.ttlMs, 7 * DAY));
  const id = `sub_${await hash(JSON.stringify([ownerId, TRAINING_EVENT_NAME, {}, url]))}`;
  const ownerGate = await hash(env.ALLOWED_USER_EMAIL.trim().toLowerCase());
  const db = dbFor(env);
  const existing = await db.prepare("SELECT * FROM brief_subscriptions WHERE id = ? AND owner_id = ?").bind(id, ownerId).first();
  const count = await db.prepare("SELECT COUNT(*) AS total FROM brief_subscriptions WHERE owner_id = ? AND expires_at > ?").bind(ownerId, now).first();
  if (!existing && count.total >= MAX_SUBSCRIPTIONS) throw error("Too many active subscriptions.", -32603, "subscription_limit");
  let verifiedAt = existing?.verified_at;
  if (!existing || existing.signing_secret !== secret || existing.owner_gate !== ownerGate || now - verifiedAt > VERIFY_CACHE) {
    const challenge = crypto.randomUUID();
    let result; try { result = await sendWebhook({ url, subscriptionId: id, secret, event: { type: "verification", challenge } }); } catch { throw error("Callback verification could not complete.", -32015, "timeout"); }
    if (!result?.accepted || result.challenge !== challenge) throw error("Callback verification failed.", -32015, result?.errorCode === "timeout" ? "timeout" : "challenge_failed");
    verifiedAt = now;
  }
  const rotated = existing && existing.signing_secret !== secret;
  const previousSecret = rotated ? existing.signing_secret : existing?.rotation_until > now ? existing.previous_secret : null;
  const rotationUntil = rotated ? now + VERIFY_CACHE : previousSecret ? existing.rotation_until : null;
  await db.prepare("INSERT INTO brief_subscriptions (id, owner_id, owner_gate, callback_url, signing_secret, previous_secret, rotation_until, verified_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET owner_gate = excluded.owner_gate, signing_secret = excluded.signing_secret, previous_secret = excluded.previous_secret, rotation_until = excluded.rotation_until, verified_at = excluded.verified_at, expires_at = excluded.expires_at")
    .bind(id, ownerId, ownerGate, url, secret, previousSecret, rotationUntil, verifiedAt, now + ttl).run();
  return { id, refreshBefore: new Date(now + ttl).toISOString(), cursor: null, truncated: false };
}
export async function unsubscribeTraining(env, ownerId, params) {
  const { url } = subscriptionParameters(params, false);
  const id = `sub_${await hash(JSON.stringify([ownerId, TRAINING_EVENT_NAME, {}, url]))}`;
  const db = dbFor(env);
  await db.prepare("DELETE FROM brief_subscriptions WHERE id = ? AND owner_id = ?").bind(id, ownerId).run();
  await db.prepare("DELETE FROM brief_deliveries WHERE subscription_id = ?").bind(id).run();
  return {};
}

export async function deliverTrainingSync(env, ownerId, syncResult, dependencies, now = Date.now()) {
  const status = syncResult?.results?.hevy?.status;
  if (!["synced", "fresh"].includes(status)) return { status: "blocked", message: "Hevy has not confirmed a completed/current sync. No Training analysis was requested." };
  const db = dbFor(env);
  const ownerGate = await hash(env.ALLOWED_USER_EMAIL.trim().toLowerCase());
  const rows = await db.prepare("SELECT * FROM brief_subscriptions WHERE owner_id = ? AND owner_gate = ? AND expires_at > ? LIMIT 4").bind(ownerId, ownerGate, now).all();
  const subscriptions = rows.results || [];
  if (!subscriptions.length) return { status: "not_connected", message: "Source data was checked. Connect and enable the Training Sync event before automatic analysis can start." };
  const input = await readReportInput("training", dependencies.readDashboard, now);
  if (input.dataState !== "live") return { status: "blocked", message: "Training evidence is missing or stale after Sync. No assistant analysis was requested." };
  let accepted = 0, alreadyAccepted = 0;
  for (const row of subscriptions) {
    const eventId = `evt_${await hash(JSON.stringify([row.id, input.sourceHash]))}`;
    const prior = await db.prepare("SELECT * FROM brief_deliveries WHERE subscription_id = ? AND source_hash = ?").bind(row.id, input.sourceHash).first();
    if (prior?.status === "accepted") { accepted++; alreadyAccepted++; continue; }
    if (prior?.status === "terminal") continue;
    const occurredAt = prior?.occurred_at || new Date(now).toISOString();
    await db.prepare("INSERT INTO brief_deliveries (subscription_id, source_hash, event_id, occurred_at, status, attempted_at) VALUES (?, ?, ?, ?, 'pending', ?) ON CONFLICT(subscription_id, source_hash) DO UPDATE SET status = 'pending', attempted_at = excluded.attempted_at").bind(row.id, input.sourceHash, eventId, occurredAt, now).run();
    const event = { eventId, name: TRAINING_EVENT_NAME, timestamp: occurredAt, data: { kind: "training", source_hash: input.sourceHash }, cursor: null };
    let result = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const active = await db.prepare("SELECT * FROM brief_subscriptions WHERE id = ? AND owner_id = ?").bind(row.id, ownerId).first();
      if (!active || active.owner_gate !== ownerGate || active.expires_at <= now || active.signing_secret !== row.signing_secret) break;
      try { result = await dependencies.sendWebhook({ url: row.callback_url, subscriptionId: row.id, secret: row.signing_secret, ...(row.previous_secret && row.rotation_until > Date.now() ? { previousSecret: row.previous_secret } : {}), event }); }
      catch { result = { accepted: false, status: null }; }
      if (result?.accepted || [410, 413].includes(result?.status) || ["invalid_input", "invalid_callback", "invalid_secret", "unsafe_address", "invalid_event", "invalid_subscription"].includes(result?.errorCode) || result?.status != null && result.status < 500 && result.status !== 429) break;
      if (attempt === 0) await (dependencies.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms))))(250);
    }
    const deliveryStatus = result?.accepted ? "accepted" : [410, 413].includes(result?.status) ? "terminal" : "failed";
    await db.prepare("UPDATE brief_deliveries SET status = ?, attempted_at = ? WHERE subscription_id = ? AND source_hash = ?").bind(deliveryStatus, now, row.id, input.sourceHash).run();
    if (result?.accepted) accepted++;
    if (result?.status === 410) await db.prepare("DELETE FROM brief_subscriptions WHERE id = ? AND owner_id = ?").bind(row.id, ownerId).run();
  }
  // Bound metadata retention; this is not an autonomous retry/polling worker.
  await db.prepare("DELETE FROM brief_deliveries WHERE attempted_at < ?").bind(now - 7 * DAY).run();
  return accepted ? { status: "queued", message: alreadyAccepted === accepted ? "This training snapshot was already accepted for assistant processing. No duplicate event was sent; check the saved review for the completed result." : "The Training Sync event was accepted for asynchronous assistant processing. Analysis is not complete yet; reopen Training later to check the saved review." }
    : { status: "unavailable", message: "Source sync completed its request, but the Training event was not accepted. No completed analysis is claimed; another explicit Sync can retry safely." };
}
