import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { deliverMcpEvent, handleMcpEventDelivery, isPublicAddress } from "../supabase/functions/hevy-actions/webhook.ts";

// Entirely fabricated metadata and sockets. No DNS, remote endpoint, or health data.
const secret = `whsec_${Buffer.alloc(32, 41).toString("base64")}`;
const previousSecret = `whsec_${Buffer.alloc(24, 71).toString("base64")}`;
const challenge = "ba61c135-84dc-48cd-b73b-e4730f456abc";
const verification = () => ({ url: "https://receiver.example.net/callback/synthetic?key=not-a-secret", subscriptionId: "sub_synthetic", secret, event: { type: "verification", challenge } });
const application = () => ({ ...verification(), event: { eventId: `evt_${"a".repeat(64)}`, name: "training.sync_completed", timestamp: "2026-10-03T15:00:00.000Z", data: { kind: "training", source_hash: "b".repeat(64) }, cursor: null } });

test('new-workout events remain metadata-only and reject accidental health payload fields',async()=>{
  const input=application();input.event.name='training.workout_completed';input.event.data={kind:'training',workout_id:'synthetic-workout'};
  const h=harness(reply('{}'));assert.equal((await deliverMcpEvent(input,h.deps)).accepted,true);
  input.event.data.weight_kg=50;const blocked=harness(reply('{}'));assert.equal((await deliverMcpEvent(input,blocked.deps)).accepted,false);
});
const reply = (body = JSON.stringify({ challenge }), headers = "", status = 200) => `HTTP/1.1 ${status} Synthetic\r\nContent-Length: ${Buffer.byteLength(body)}\r\n${headers}\r\n${body}`;
function harness(response = reply(), options = {}) {
  let now = Date.parse("2026-10-03T15:05:00.000Z"), timerCallback;
  const calls = [], written = [], closeCounts = { raw: 0, tls: 0 };
  const source = Buffer.from(response);
  let position = 0;
  const raw = { close() { closeCounts.raw++; }, read() { throw new Error("unsecured read"); }, write() { throw new Error("unsecured write"); } };
  const tls = {
    close() { closeCounts.tls++; options.onClose?.(); },
    async handshake() { calls.push(["handshake"]); if (options.handshake) return options.handshake(); },
    async write(bytes) {
      const size = Math.min(options.writeSize || bytes.length, bytes.length);
      written.push(Buffer.from(bytes.subarray(0, size))); return size;
    },
    async read(buffer) {
      if (options.read) return options.read(buffer);
      if (position === source.length) return null;
      const size = Math.min(options.readSize || source.length, buffer.length, source.length - position);
      buffer.set(source.subarray(position, position + size)); position += size; return size;
    },
  };
  const deps = {
    async resolveDns(host, type, signal) { calls.push(["dns", host, type, signal]); return options.resolveDns ? options.resolveDns(host, type, signal) : type === "A" ? ["8.8.8.8"] : ["2606:4700:4700::1111"]; },
    async connect(ip, signal) { calls.push(["connect", ip, signal]); return options.connect ? options.connect(ip, signal) : raw; },
    async startTls(socket, hostname) { calls.push(["tls", socket, hostname]); return options.startTls ? options.startTls(socket, hostname) : tls; },
    now: () => now,
    randomUUID: () => "67a29f1b-c4f2-4949-b32c-c5c35dc678ae",
    setTimer(callback, ms) { calls.push(["timer", ms]); timerCallback = callback; return 1; },
    clearTimer() { calls.push(["clear"]); },
  };
  return { deps, calls, written, raw, tls, closeCounts, expire() { now += 8000; timerCallback(); }, request() { return Buffer.concat(written).toString(); } };
}
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("pins the validated DNS literal while TLS and Host retain original callback hostname", async () => {
  const h = harness(reply(), { readSize: 1, writeSize: 7 });
  assert.deepEqual(await deliverMcpEvent(verification(), h.deps), { accepted: true, status: 200, challenge });
  assert.deepEqual(h.calls.filter(([call]) => call === "connect").map((call) => call[1]), ["8.8.8.8"]);
  assert.equal(h.calls.find(([call]) => call === "tls")[1], h.raw);
  assert.equal(h.calls.find(([call]) => call === "tls")[2], "receiver.example.net");
  assert.match(h.request(), /^POST \/callback\/synthetic\?key=not-a-secret HTTP\/1.1\r\nHost: receiver.example.net\r\n/);
  assert.match(h.request(), /Connection: close\r\n/);
  assert.equal(h.closeCounts.raw, 1); assert.equal(h.closeCounts.tls, 1);
});

test("Standard Webhooks signs exact serialized bytes; rotation sends both signatures", async () => {
  const input = { ...application(), previousSecret };
  const h = harness("HTTP/1.1 204 No Content\r\n\r\n");
  assert.deepEqual(await deliverMcpEvent(input, h.deps), { accepted: true, status: 204 });
  const [headers, body] = h.request().split("\r\n\r\n");
  assert.equal(body, JSON.stringify(input.event));
  const id = headers.match(/webhook-id: (.*)\r\n/)[1];
  assert.equal(id, input.event.eventId);
  const time = headers.match(/webhook-timestamp: (.*)\r\n/)[1];
  const expected = [secret, previousSecret].map((key) => `v1,${createHmac("sha256", Buffer.from(key.slice(6), "base64")).update(`${id}.${time}.${body}`).digest("base64")}`).join(" ");
  assert.equal(headers.match(/webhook-signature: (.*)\r\n/)[1], expected);
  assert.match(headers, /X-MCP-Subscription-Id: sub_synthetic/);
});

test("verification has a fresh server-generated delivery ID and echoes only exact challenge", async () => {
  const h = harness(); await deliverMcpEvent(verification(), h.deps);
  assert.match(h.request(), /webhook-id: verification_67a29f1b-c4f2-4949-b32c-c5c35dc678ae\r\n/);
  for (const body of [JSON.stringify({ challenge: challenge.toUpperCase() }), JSON.stringify({ challenge, extra: secret }), "not json", JSON.stringify({ challenge: `${challenge}x` })]) {
    assert.deepEqual(await deliverMcpEvent(verification(), harness(reply(body)).deps), { accepted: false, status: 200, errorCode: "challenge_failed" });
  }
});

test("public-address classifier rejects all special families and noncanonical literals", () => {
  for (const ip of ["0.0.0.0", "10.1.2.3", "100.64.0.1", "100.127.255.255", "127.2.3.4", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.9", "192.0.2.1", "192.88.99.1", "192.168.0.1", "198.18.0.1", "198.19.255.255", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255", "1.2.3.999", "010.0.0.1", "2130706433", "0x7f000001", "localhost", "::", "::1", "::ffff:8.8.8.8", "::ffff:808:808", "64:ff9b::808:808", "64:ff9b:1::1", "100::1", "2001::1", "2001:10::1", "2001:20::1", "2001:db8::1", "2002:7f00:1::", "3fff:fff::1", "fc00::1", "fe80::1", "ff02::1", "2606:4700::1111%eth0", "2001:::1", "2001::1::2", "2001:4860:1:2:3:4:5:6:7", "2001:4860:"]) assert.equal(isPublicAddress(ip), false, ip);
  for (const ip of ["1.1.1.1", "8.8.8.8", "100.128.0.1", "172.32.0.1", "192.1.2.3", "2001:4860:4860::8888", "2606:4700:4700::1111", "2001:4860:0000:0000:0000:0000:0000:8888"]) assert.equal(isPublicAddress(ip), true, ip);
});

test("rejects unsafe URLs, secrets, schema, or source health data before DNS", async () => {
  const badInputs = [null, {}, { ...application(), extra: true }, ...["https:receiver.example.net", "https:/receiver.example.net", "https:///receiver.example.net", "http://receiver.example.net/a", "https://receiver.example.net:8443/a", "https://x@y.example.net/a", "https://receiver.example.net/a#", "https://receiver.example.net./a", "https://localhost/a", "https://127.0.0.1/a", "https://[::1]/a", "https://2130706433/a", "https://receiver.example.net/\r\na", "https://receiver.example.net\\@elsewhere.net/a", "https://user%40@receiver.example.net/a"].map((url) => ({ ...application(), url })),
    ...["whsec_AA==", `whsec_${Buffer.alloc(65).toString("base64")}`, "whsec_!!!!", secret + "="].map((secret) => ({ ...application(), secret })),
    { ...application(), previousSecret: "invalid" }, { ...application(), subscriptionId: "sub\r\nInjected: x" },
    { ...application(), event: { ...application().event, data: { kind: "training", source_hash: "a".repeat(64), heart_rate: 70 } } },
    { ...application(), event: { ...application().event, name: "other.event" } },
    { ...application(), event: { ...application().event, timestamp: "2026-02-30T15:00:00.000Z" } },
    { ...application(), event: { ...application().event, eventId: "evt_bad" } },
    { ...verification(), event: { type: "verification", challenge: "not-a-uuid" } },
  ];
  for (const input of badInputs) {
    const h = harness(); const result = await deliverMcpEvent(input, h.deps);
    assert.equal(result.accepted, false, JSON.stringify(input)); assert.equal(h.calls.length, 0);
  }
});

test("one unsafe A or AAAA answer blocks all sockets; DNS errors fail closed", async () => {
  for (const addresses of [["8.8.8.8", "127.0.0.1"], ["2606:4700::1111", "::ffff:7f00:1"], []]) {
    const h = harness(reply(), { resolveDns: async () => addresses });
    const result = await deliverMcpEvent(application(), h.deps);
    assert.equal(result.errorCode, addresses.length ? "unsafe_address" : "dns_failed");
    assert.equal(h.calls.some(([call]) => call === "connect"), false);
  }
  const failure = harness(reply(), { resolveDns: async () => { throw new Error("sensitive DNS diagnostic"); } });
  assert.deepEqual(await deliverMcpEvent(application(), failure.deps), { accepted: false, status: null, errorCode: "dns_failed" });
  const oneFamily = harness(reply(), { resolveDns: async (_host, type) => { if (type === "A") return ["8.8.8.8"]; throw Object.assign(new Error("No AAAA"), { name: "NotFound" }); } });
  assert.equal((await deliverMcpEvent(verification(), oneFamily.deps)).accepted, true);
});

test("chunked responses support arbitrary splits, chunk extensions, trailers, interim responses and EOF", async () => {
  const body = JSON.stringify({ challenge });
  const wire = `HTTP/1.1 103 Early Hints\r\nLink: </synthetic>\r\n\r\nHTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n${body.length.toString(16)};test="a;b"\r\n${body}\r\n0\r\nX-Synthetic: ok\r\n\r\n`;
  for (const readSize of [1, 3, 19, 4096]) assert.equal((await deliverMcpEvent(verification(), harness(wire, { readSize }).deps)).accepted, true);
  assert.equal((await deliverMcpEvent(verification(), harness(`HTTP/1.0 200 OK\r\n\r\n${body}`).deps)).accepted, true);
});

test("rejects ambiguous, malformed, truncated, oversized, compressed or upgraded responses", async () => {
  const bad = [
    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nContent-Length: 0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 0,0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: -1\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 99999999\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Encoding: gzip\r\nContent-Length: 0\r\n\r\n",
    "HTTP/1.1 101 Switching Protocols\r\n\r\n",
    "HTTP/1.1 204 No Content\r\nContent-Length: 1\r\n\r\nx",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, chunked\r\n\r\n",
    "HTTP/1.0 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nx\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1\r\nx!!0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\nContent-Length: 0\r\n\r\n",
    "HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\nx",
    "HTTP/1.1 200 OK\r\n folded: invalid\r\n\r\n",
    "HTTP/1.1 200 OK\r\nX-Big: " + "x".repeat(17000) + "\r\n\r\n",
    "HTTP/1.1 200 OK\r\n\r\n" + "x".repeat(17000),
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5000\r\n" + "x".repeat(20480),
    "HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\nEXTRA",
  ];
  for (const response of bad) {
    const h = harness(response); const result = await deliverMcpEvent(application(), h.deps);
    assert.equal(result.accepted, false, response.slice(0, 100));
    assert.ok(["invalid_response", "response_too_large"].includes(result.errorCode));
    assert.equal(h.closeCounts.tls, 1);
  }
});

test("redirects and callback errors are sanitized and never followed or retried", async () => {
  for (const status of [301, 302, 307, 308, 400, 410, 413, 500]) {
    const h = harness(reply("sensitive error body", "Location: https://127.0.0.1/secret\r\n", status));
    assert.deepEqual(await deliverMcpEvent(application(), h.deps), { accepted: false, status, errorCode: "callback_rejected" });
    assert.equal(h.calls.filter(([call]) => call === "connect").length, 1);
  }
});

test("TLS failure sends no application bytes and closes acquired resources", async () => {
  const h = harness(reply(), { handshake: async () => { throw new Error("secret hostname diagnostic"); } });
  assert.deepEqual(await deliverMcpEvent(application(), h.deps), { accepted: false, status: null, errorCode: "transport_failed" });
  assert.equal(h.request(), ""); assert.equal(h.closeCounts.raw, 1); assert.equal(h.closeCounts.tls, 1);
});

test("total timeout aborts DNS and prevents any later connect", async () => {
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const h = harness(reply(), { resolveDns: () => pending });
  const result = deliverMcpEvent(application(), h.deps); await settle(); h.expire();
  assert.deepEqual(await result, { accepted: false, status: null, errorCode: "timeout" });
  assert.ok(h.calls.filter(([call]) => call === "dns").every((call) => call[3].aborted));
  resolve(["8.8.8.8"]); await settle();
  assert.equal(h.calls.some(([call]) => call === "connect"), false);
});

test("total timeout closes a late TCP connection without starting TLS", async () => {
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const h = harness(reply(), { connect: () => pending });
  const result = deliverMcpEvent(application(), h.deps); await settle(); h.expire();
  assert.equal((await result).errorCode, "timeout");
  resolve(h.raw); await settle();
  assert.equal(h.closeCounts.raw, 1); assert.equal(h.calls.some(([call]) => call === "tls"), false);
});

test("total timeout closes late TLS resources and pending read connections", async () => {
  let resolve; const pending = new Promise((done) => { resolve = done; });
  const h = harness(reply(), { startTls: () => pending });
  const result = deliverMcpEvent(application(), h.deps); await settle(); h.expire();
  assert.equal((await result).errorCode, "timeout");
  resolve(h.tls); await settle();
  assert.equal(h.closeCounts.raw, 1); assert.equal(h.closeCounts.tls, 1); assert.equal(h.request(), "");
  let rejectRead;
  const reading = harness(reply(), { read: () => new Promise((_, reject) => { rejectRead = reject; }), onClose: () => rejectRead?.(new Error("closed")) });
  const outcome = deliverMcpEvent(application(), reading.deps);
  for (let i = 0; i < 20 && !rejectRead; i++) await settle();
  reading.expire(); assert.equal((await outcome).errorCode, "timeout");
  assert.equal(reading.closeCounts.tls, 1); await settle();
});

test("request wrapper bounds input and never returns data, callback paths or secrets", async () => {
  const h = harness();
  assert.equal((await handleMcpEventDelivery(new Request("https://local.invalid/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(verification()) }), h.deps)).accepted, true);
  for (const request of [
    new Request("https://local.invalid/", { method: "POST", body: "bad" }),
    new Request("https://local.invalid/", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" }),
    new Request("https://local.invalid/", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(13000) }),
    new Request("https://local.invalid/", { method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "13000" }, body: "{}" }),
  ]) {
    const result = await handleMcpEventDelivery(request, h.deps);
    assert.deepEqual(result, { accepted: false, status: null, errorCode: "invalid_input" });
  }
});

test("route remains behind existing API key authorization and codex-plugin restriction", async () => {
  const index = await readFile(new URL("../supabase/functions/hevy-actions/index.ts", import.meta.url), "utf8");
  assert.ok(index.indexOf("const caller = authorize(req)") < index.indexOf('path[1] === "mcp-event-delivery"'));
  assert.match(index, /path\[1\] === "mcp-event-delivery" && path.length === 2/);
  assert.match(index, /caller !== "codex_plugin"\) return json\(\{ accepted: false, status: null, errorCode: "forbidden" \}, 403\)/);
  const sender = await readFile(new URL("../supabase/functions/hevy-actions/webhook.ts", import.meta.url), "utf8");
  assert.doesNotMatch(sender, /\bfetch\s*\(|console\./);
});
