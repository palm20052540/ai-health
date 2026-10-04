import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { subscribeTraining, unsubscribeTraining, deliverTrainingSync, TRAINING_EVENT_NAME } from "../worker/briefEvents.js";
import { handleBriefMcp } from "../worker/briefMcp.js";

const NOW = Date.now(); const ISO = new Date(NOW - 10000).toISOString();
const SECRET = `whsec_${btoa("synthetic-signing-key-not-live-123")}`;
const SECOND = `whsec_${btoa("another-synthetic-signing-key-456")}`;
const URL = "https://callback.example.test/accepted";
const subscriptions = [];
function env() {
  const db = new DatabaseSync(":memory:"); subscriptions.push(db);
  for (const filename of ["0000_magenta_patriot.sql", "0001_thankful_korg.sql"]) db.exec(readFileSync(new globalThis.URL(`../drizzle/${filename}`, import.meta.url), "utf8"));
  return { ALLOWED_USER_EMAIL: "owner@example.test", BRIEF_DB: { prepare(sql) { return { bind(...args) { return { first: async () => db.prepare(sql).get(...args) || null, all: async () => ({ results: db.prepare(sql).all(...args) }), run: async () => db.prepare(sql).run(...args) }; } }; } }, raw: db };
}
after(() => { for (const db of subscriptions) db.close(); });
const params = (secret = SECRET) => ({ name: TRAINING_EVENT_NAME, arguments: {}, delivery: { mode: "webhook", url: URL, secret }, cursor: null });
const verify = async (payload) => ({ accepted: true, status: 200, challenge: payload.event.challenge });
const modernMeta = {
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "synthetic-client", version: "1" },
  "synthetic.example/context": { ignored: true },
};
function fixture() { return { generated_at: ISO, recap: { freshness: { hevy: { synced_at: ISO, start_time: ISO } } }, recent_workouts: [{ id: "workout-1", start_time: ISO }], exercise_progress: [{ exercise_template_id: "press-1", query: "Synthetic press", sessions: [{ exercise_template_id: "press-1", workout_id: "workout-1", start_time: ISO, working_sets: 2, best_set: { weight_kg: 50, reps: 8 }, average_rpe: 7, rpe_count: 2, rpe_coverage_percent: 100 }] }] }; }

test("subscription verifies once, persists across requests, renews idempotently and reveals no secret", async () => {
  const config = env(); let calls = 0;
  const sender = async (payload) => { calls++; assert.equal(payload.event.type, "verification"); return verify(payload); };
  const first = await subscribeTraining(config, "owner", params(), sender, NOW);
  const repeated = await subscribeTraining(config, "owner", params(), sender, NOW + 1000);
  assert.equal(first.id, repeated.id); assert.equal(calls, 1);
  assert.equal(config.raw.prepare("SELECT COUNT(*) AS n FROM brief_subscriptions").get().n, 1);
  assert.ok(!JSON.stringify(first).includes(SECRET));
  assert.ok(Date.parse(repeated.refreshBefore) > NOW);
});

test("protocol metadata supports subscription renewal and unsubscribe without changing identity or delivery", async () => {
  const config = env(); const sent = [];
  const sender = async (payload) => { sent.push(payload); return verify(payload); };
  const original = await subscribeTraining(config, "owner", params(), sender, NOW);
  const request = { ...params(), _meta: modernMeta };
  const repeated = await subscribeTraining(config, "owner", request, sender, NOW + 1000);
  assert.equal(original.id, repeated.id); assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent).includes("synthetic.example/context"));
  assert.ok(!JSON.stringify(config.raw.prepare("SELECT * FROM brief_subscriptions").get()).includes("synthetic.example/context"));
  const stop = { name: TRAINING_EVENT_NAME, arguments: {}, delivery: { mode: "webhook", url: URL }, _meta: modernMeta };
  await unsubscribeTraining(config, "other-owner", stop);
  assert.equal(config.raw.prepare("SELECT COUNT(*) AS n FROM brief_subscriptions").get().n, 1);
  await unsubscribeTraining(config, "owner", stop);
  assert.equal(config.raw.prepare("SELECT COUNT(*) AS n FROM brief_subscriptions").get().n, 0);
});

test("malformed metadata and unknown business fields fail before callback verification", async () => {
  const config = env(); let calls = 0;
  const sender = async (payload) => { calls++; return verify(payload); };
  for (const _meta of [null, [], "owner", true, 1]) {
    await assert.rejects(subscribeTraining(config, "owner", { ...params(), _meta }, sender, NOW), { rpcCode: -32602 });
    await assert.rejects(unsubscribeTraining(config, "owner", { name: TRAINING_EVENT_NAME, arguments: {}, delivery: { mode: "webhook", url: URL }, _meta }), { rpcCode: -32602 });
  }
  await assert.rejects(subscribeTraining(config, "owner", { ...params(), _meta: modernMeta, ownerId: "spoofed" }, sender, NOW), { rpcCode: -32602 });
  assert.equal(calls, 0);
  assert.equal(config.raw.prepare("SELECT COUNT(*) AS n FROM brief_subscriptions").get().n, 0);
});

test("modern MCP responses declare completion and private cache hints while legacy shapes remain compatible", async () => {
  const config = env(); let callbacks = 0;
  const deps = { sendWebhook: async (payload) => { callbacks++; return verify(payload); } };
  const call = async (method, params, identity = false) => handleBriefMcp(new Request("https://site.example/mcp", { method: "POST", headers: identity ? { "oai-authenticated-user-email": "owner@example.test", "oai-authenticated-user-id": "owner" } : {}, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) }), config, deps);
  const legacy = await (await call("initialize", {})).json();
  assert.equal(legacy.result.protocolVersion, "2025-03-26"); assert.equal(legacy.result.resultType, undefined);
  const legacyTools = await (await call("tools/list", {})).json();
  assert.equal(legacyTools.result.ttlMs, undefined);
  for (const method of ["server/discover", "tools/list"]) {
    const reply = await (await call(method, { _meta: modernMeta })).json();
    assert.equal(reply.result.resultType, "complete"); assert.equal(reply.result.ttlMs, 0); assert.equal(reply.result.cacheScope, "private");
  }
  assert.equal((await (await call("events/list", { _meta: modernMeta })).json()).result.resultType, "complete");
  assert.equal((await call("events/subscribe", { ...params(), _meta: { ...modernMeta, ownerId: "owner", email: "owner@example.test" } })).status, 401);
  assert.equal(callbacks, 0);
  const accepted = await (await call("events/subscribe", { ...params(), _meta: modernMeta }, true)).json();
  assert.equal(accepted.result.resultType, "complete"); assert.equal(callbacks, 1);
  const stop = { name: TRAINING_EVENT_NAME, arguments: {}, delivery: { mode: "webhook", url: URL }, _meta: modernMeta };
  assert.equal((await (await call("events/unsubscribe", stop, true)).json()).result.resultType, "complete");
});

test("callback failures, invalid destinations, schemas and unsigned secrets never activate a subscription", async () => {
  const config = env(); let calls = 0;
  const sender = async () => { calls++; return { accepted: false, status: 400 }; };
  await assert.rejects(subscribeTraining(config, "owner", params(), sender, NOW), { rpcCode: -32015 });
  assert.equal(config.raw.prepare("SELECT COUNT(*) AS n FROM brief_subscriptions").get().n, 0);
  for (const change of [{ name: "arbitrary.event" }, { arguments: { health: "secret" } }, { delivery: { mode: "webhook", url: "http://callback.example.test", secret: SECRET } }, { delivery: { mode: "webhook", url: URL, secret: "not-a-key" } }, { delivery: { mode: "webhook", url: "https://user:pass@callback.example.test", secret: SECRET } }]) await assert.rejects(subscribeTraining(config, "owner", { ...params(), ...change }, sender, NOW));
  assert.equal(calls, 1);
});

test("secret rotation verifies the replacement and retains a bounded dual-signing grace period", async () => {
  const config = env(); let calls = 0;
  const sender = async (payload) => { calls++; return verify(payload); };
  const first = await subscribeTraining(config, "owner", params(), sender, NOW);
  const rotated = await subscribeTraining(config, "owner", params(SECOND), sender, NOW + 1000);
  assert.equal(first.id, rotated.id); assert.equal(calls, 2);
  const row = config.raw.prepare("SELECT * FROM brief_subscriptions").get();
  assert.equal(row.signing_secret, SECOND); assert.equal(row.previous_secret, SECRET);
  assert.equal(row.rotation_until, NOW + 301000);
});

test("successful Sync delivers only metadata and deduplicates the same snapshot", async () => {
  const config = env(); await subscribeTraining(config, "owner", params(), verify, NOW);
  const sent = []; const deps = { readDashboard: async () => fixture(), sendWebhook: async (payload) => { sent.push(payload); return { accepted: true, status: 202 }; } };
  const result = await deliverTrainingSync(config, "owner", { results: { hevy: { status: "synced" } } }, deps, NOW);
  assert.equal(result.status, "queued"); assert.match(result.message, /not complete/);
  assert.equal(sent.length, 1); assert.equal(sent[0].event.name, TRAINING_EVENT_NAME);
  assert.deepEqual(Object.keys(sent[0].event.data).sort(), ["kind", "source_hash"]);
  assert.ok(!JSON.stringify(sent[0].event).includes("Synthetic press"));
  await deliverTrainingSync(config, "owner", { results: { hevy: { status: "fresh" } } }, deps, NOW);
  assert.equal(sent.length, 1);
});

test("partial, running, stale, unconnected and revoked-owner states never deliver", async () => {
  const config = env(); let sent = 0;
  const deps = { readDashboard: async () => fixture(), sendWebhook: async () => { sent++; return { accepted: true }; } };
  for (const status of ["partial_failure", "sync_in_progress", "cooldown_active", "unknown"]) assert.equal((await deliverTrainingSync(config, "owner", { results: { hevy: { status } } }, deps, NOW)).status, "blocked");
  assert.equal((await deliverTrainingSync(config, "owner", { results: { hevy: { status: "synced" } } }, deps, NOW)).status, "not_connected");
  await subscribeTraining(config, "owner", params(), verify, NOW);
  assert.equal((await deliverTrainingSync(config, "owner", { results: { hevy: { status: "synced" } } }, { ...deps, readDashboard: async () => ({ ...fixture(), sample: true }) }, NOW)).status, "blocked");
  config.ALLOWED_USER_EMAIL = "changed@example.test";
  assert.equal((await deliverTrainingSync(config, "owner", { results: { hevy: { status: "synced" } } }, deps, NOW)).status, "not_connected");
  assert.equal(sent, 0);
});

test("bounded retry preserves event ID and terminal responses never replay", async () => {
  const config = env(); await subscribeTraining(config, "owner", params(), verify, NOW);
  const ids = []; const deps = { readDashboard: async () => fixture(), sleep: async () => {}, sendWebhook: async (payload) => { ids.push(payload.event.eventId); return { accepted: false, status: ids.length === 1 ? 503 : 413 }; } };
  assert.equal((await deliverTrainingSync(config, "owner", { results: { hevy: { status: "fresh" } } }, deps, NOW)).status, "unavailable");
  assert.equal(ids.length, 2); assert.equal(ids[0], ids[1]);
  await deliverTrainingSync(config, "owner", { results: { hevy: { status: "fresh" } } }, deps, NOW);
  assert.equal(ids.length, 2);
});

test("unsubscribe is owner-scoped and idempotent; expired subscriptions cannot send", async () => {
  const config = env(); await subscribeTraining(config, "owner", { ...params(), ttlMs: 60000 }, verify, NOW);
  const stop = { name: TRAINING_EVENT_NAME, arguments: {}, delivery: { mode: "webhook", url: URL } };
  await unsubscribeTraining(config, "other-owner", stop);
  assert.equal(config.raw.prepare("SELECT COUNT(*) AS n FROM brief_subscriptions").get().n, 1);
  let sent = 0;
  assert.equal((await deliverTrainingSync(config, "owner", { results: { hevy: { status: "synced" } } }, { readDashboard: async () => fixture(), sendWebhook: async () => { sent++; } }, NOW + 61000)).status, "not_connected");
  await unsubscribeTraining(config, "owner", stop); await unsubscribeTraining(config, "owner", stop);
  assert.equal(sent, 0); assert.equal(config.raw.prepare("SELECT COUNT(*) AS n FROM brief_subscriptions").get().n, 0);
});

test("a subscription revoked during a failed attempt is not retried", async () => {
  const config = env(); await subscribeTraining(config, "owner", params(), verify, NOW);
  let sent = 0;
  const stop = { name: TRAINING_EVENT_NAME, arguments: {}, delivery: { mode: "webhook", url: URL } };
  const result = await deliverTrainingSync(config, "owner", { results: { hevy: { status: "fresh" } } }, { readDashboard: async () => fixture(), sleep: async () => {}, sendWebhook: async () => { sent++; await unsubscribeTraining(config, "owner", stop); return { accepted: false, status: 503 }; } }, NOW);
  assert.equal(result.status, "unavailable"); assert.equal(sent, 1);
});

test("MCP 2 event discovery works while subscriptions require authenticated owner", async () => {
  const config = env(); const call = (method, params = {}) => new Request("https://site.example/mcp", { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const discover = await (await handleBriefMcp(call("server/discover"), config, {})).json();
  assert.deepEqual(discover.result.supportedVersions, ["2026-07-28"]);
  assert.ok(discover.result.capabilities.events);
  const list = await (await handleBriefMcp(call("events/list"), config, {})).json();
  assert.equal(list.result.events[0].name, TRAINING_EVENT_NAME);
  assert.equal((await handleBriefMcp(call("events/subscribe", params()), config, {})).status, 401);
});
