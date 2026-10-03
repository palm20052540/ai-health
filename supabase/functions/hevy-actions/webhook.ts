/** Metadata-only MCP callback delivery. Never use fetch: DNS is pinned before TLS. */
const enc = new TextEncoder();
const MAX_INPUT = 12 * 1024;
const MAX_HEADERS = 16 * 1024;
const MAX_BODY = 16 * 1024;
const MAX_WIRE = 64 * 1024;
const TOTAL_MS = 8_000;
const ID = /^evt_[a-f0-9]{64}$/;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

type JsonObject = Record<string, unknown>;
type Socket = {
  read(buffer: Uint8Array): Promise<number | null>;
  write(buffer: Uint8Array): Promise<number>;
  close(): void;
  handshake?(): Promise<unknown>;
};
export type WebhookDependencies = {
  resolveDns(host: string, type: "A" | "AAAA", signal: AbortSignal): Promise<string[]>;
  connect(ip: string, signal: AbortSignal): Promise<Socket>;
  startTls(socket: Socket, hostname: string): Promise<Socket>;
  now(): number;
  randomUUID(): string;
  setTimer(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
  clearTimer(timer: ReturnType<typeof setTimeout>): void;
};
export type DeliveryOutcome = { accepted: boolean; status: number | null; challenge?: string; errorCode?: string };
class DeliveryError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new DeliveryError(code); }
function object(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}
function keys(value: JsonObject, required: string[], optional: string[] = []): boolean {
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function text(value: unknown, pattern: RegExp): value is string { return typeof value === "string" && pattern.test(value); }
function decodeSecret(value: unknown): Uint8Array {
  if (typeof value !== "string" || !/^whsec_(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) fail("invalid_secret");
  let raw: string;
  try { raw = atob(value.slice(6)); } catch { return fail("invalid_secret"); }
  if (raw.length < 24 || raw.length > 64 || btoa(raw) !== value.slice(6)) fail("invalid_secret");
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}
function callbackUrl(value: unknown): URL {
  if (typeof value !== "string" || value.length > 4096 || /[\s\\#]/.test(value) || [...value].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) fail("invalid_callback");
  const authority = /^https:\/\/([^/?#]+)(?:[/?]|$)/i.exec(value)?.[1];
  if (!authority || /[%@]/.test(authority)) fail("invalid_callback");
  let url: URL;
  try { url = new URL(value); } catch { return fail("invalid_callback"); }
  const host = url.hostname;
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443") ||
    !host.includes(".") || host.length > 253 || host.endsWith(".") || /^\d+(\.\d+){3}$/.test(host) ||
    !host.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) fail("invalid_callback");
  return url;
}
function validate(value: unknown) {
  if (!object(value) || !keys(value, ["url", "subscriptionId", "secret", "event"], ["previousSecret"])) fail("invalid_input");
  const url = callbackUrl(value.url);
  if (!text(value.subscriptionId, /^[A-Za-z0-9_-]{1,160}$/)) fail("invalid_subscription");
  const secret = decodeSecret(value.secret);
  const previousSecret = value.previousSecret == null ? null : decodeSecret(value.previousSecret);
  const event = value.event;
  if (!object(event)) fail("invalid_event");
  if (event.type === "verification") {
    if (!keys(event, ["type", "challenge"]) || !text(event.challenge, UUID)) fail("invalid_event");
  } else {
    if (!keys(event, ["eventId", "name", "timestamp", "data", "cursor"]) || !text(event.eventId, ID) ||
      event.name !== "training.sync_completed" || event.cursor !== null || typeof event.timestamp !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(event.timestamp) ||
      !Number.isFinite(Date.parse(event.timestamp)) || new Date(event.timestamp).toISOString() !== event.timestamp ||
      !object(event.data) || !keys(event.data, ["kind", "source_hash"]) || event.data.kind !== "training" || !text(event.data.source_hash, HASH)) fail("invalid_event");
  }
  const body = JSON.stringify(event);
  if (enc.encode(body).length > MAX_BODY) fail("invalid_event");
  return { url, subscriptionId: value.subscriptionId, secret, previousSecret, event, body };
}

/** Conservative global-unicast allowlist; rejects mapped/translation/special ranges. */
export function isPublicAddress(ip: string): boolean {
  if (typeof ip !== "string" || ip.includes("%")) return false;
  if (/^(?:0|[1-9]\d{0,2})(?:\.(?:0|[1-9]\d{0,2})){3}$/.test(ip)) {
    const octets = ip.split(".").map(Number);
    if (octets.some((n) => n > 255)) return false;
    const [a, b, c] = octets;
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113));
  }
  if (!/^[0-9a-f:]+$/i.test(ip) || !ip.includes(":")) return false;
  const split = ip.toLowerCase().split("::");
  if (split.length > 2) return false;
  const left = split[0] ? split[0].split(":") : [];
  const right = split.length === 2 && split[1] ? split[1].split(":") : [];
  if ([...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return false;
  const count = left.length + right.length;
  if ((split.length === 1 && count !== 8) || (split.length === 2 && count >= 8)) return false;
  const words = [...left, ...Array(split.length === 2 ? 8 - count : 0).fill("0"), ...right].map((word) => parseInt(word, 16));
  const [a, b] = words;
  return a >= 0x2000 && a <= 0x3fff &&
    !(a === 0x2001 && (b <= 0x1ff || b === 0xdb8)) && a !== 0x2002 && !(a === 0x3fff && b <= 0x0fff);
}
function safeClose(socket: Socket) { try { socket.close(); } catch { /* Consumed or already closed. */ } }
function defaultDependencies(): WebhookDependencies {
  return {
    resolveDns: (host, type, signal) => Deno.resolveDns(host, type, { signal }),
    connect: (ip, signal) => Deno.connect({ hostname: ip, port: 443, transport: "tcp", signal }),
    startTls: (socket, hostname) => Deno.startTls(socket as Deno.TcpConn, { hostname, alpnProtocols: ["http/1.1"] }),
    now: Date.now,
    randomUUID: () => crypto.randomUUID(),
    setTimer: (callback, ms) => setTimeout(callback, ms),
    clearTimer: (timer) => clearTimeout(timer),
  };
}
/** Fixed-work comparison for the bounded, same-shape verification challenges. */
function equalChallenge(actual: string, expected: string): boolean {
  const a = enc.encode(actual), b = enc.encode(expected);
  let mismatch = a.length ^ b.length;
  for (let i = 0; i < 256; i++) mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return mismatch === 0;
}
async function signature(secret: Uint8Array, id: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new Uint8Array(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(`${id}.${timestamp}.${body}`)));
  return `v1,${btoa(String.fromCharCode(...digest))}`;
}

class ResponseReader {
  private buffer = new Uint8Array(0);
  private bytes = 0;
  private socket: Socket;
  private check: () => void;
  constructor(socket: Socket, check: () => void) { this.socket = socket; this.check = check; }
  async more(): Promise<boolean> {
    this.check();
    const next = new Uint8Array(4096);
    const size = await this.socket.read(next);
    this.check();
    if (size === null) return false;
    if (!Number.isInteger(size) || size <= 0 || size > next.length) fail("invalid_response");
    this.bytes += size;
    if (this.bytes > MAX_WIRE) fail("response_too_large");
    const combined = new Uint8Array(this.buffer.length + size);
    combined.set(this.buffer); combined.set(next.subarray(0, size), this.buffer.length);
    this.buffer = combined;
    return true;
  }
  async line(limit: number): Promise<string> {
    for (;;) {
      const index = this.buffer.findIndex((byte, i) => byte === 13 && this.buffer[i + 1] === 10);
      if (index >= 0) {
        if (index + 2 > limit) fail("response_too_large");
        const line = this.buffer.slice(0, index);
        this.buffer = this.buffer.slice(index + 2);
        if (line.some((byte) => byte > 126 || byte < 32 && byte !== 9)) fail("invalid_response");
        return String.fromCharCode(...line);
      }
      if (this.buffer.length >= limit) fail("response_too_large");
      if (!await this.more()) fail("invalid_response");
    }
  }
  async exactly(length: number): Promise<Uint8Array> {
    while (this.buffer.length < length) if (!await this.more()) fail("invalid_response");
    const bytes = this.buffer.slice(0, length);
    this.buffer = this.buffer.slice(length);
    return bytes;
  }
  async toEnd(): Promise<Uint8Array> {
    while (await this.more()) if (this.buffer.length > MAX_BODY) fail("response_too_large");
    if (this.buffer.length > MAX_BODY) fail("response_too_large");
    const body = this.buffer; this.buffer = new Uint8Array(0); return body;
  }
  noExtra() { if (this.buffer.length) fail("invalid_response"); }
}
function header(line: string): [string, string] {
  const colon = line.indexOf(":");
  const name = line.slice(0, colon);
  if (colon <= 0 || !/^[!#$%&'*+.^_`|~A-Za-z0-9-]+$/.test(name)) fail("invalid_response");
  return [name.toLowerCase(), line.slice(colon + 1).trim()];
}
async function readResponse(socket: Socket, check: () => void): Promise<{ status: number; body: Uint8Array }> {
  const reader = new ResponseReader(socket, check);
  let headerBytes = 0;
  const line = async () => {
    const value = await reader.line(MAX_HEADERS - headerBytes);
    headerBytes += value.length + 2;
    return value;
  };
  for (let interim = 0; interim < 5; interim++) {
    const statusLine = await line();
    const match = /^HTTP\/1\.[01] ([1-5]\d{2})(?: [\x20-\x7e]*)?$/.exec(statusLine);
    if (!match) fail("invalid_response");
    const status = Number(match[1]);
    const headers = new Map<string, string>();
    for (;;) {
      const current = await line();
      if (current === "") break;
      const [name, value] = header(current);
      if (headers.has(name) && ["content-length", "transfer-encoding", "content-encoding"].includes(name)) fail("invalid_response");
      headers.set(name, value);
    }
    const length = headers.get("content-length"), transfer = headers.get("transfer-encoding");
    if (length !== undefined && (!/^\d{1,8}$/.test(length) || Number(length) > MAX_BODY)) fail("invalid_response");
    if (transfer !== undefined && (transfer.toLowerCase() !== "chunked" || length !== undefined || statusLine.startsWith("HTTP/1.0"))) fail("invalid_response");
    if (headers.has("content-encoding") && headers.get("content-encoding")!.toLowerCase() !== "identity") fail("invalid_response");
    if (status < 200) {
      if (![100, 102, 103].includes(status) || length !== undefined || transfer !== undefined) fail("invalid_response");
      continue;
    }
    if (status === 204 || status === 304) {
      if (transfer !== undefined || length !== undefined && length !== "0") fail("invalid_response");
      reader.noExtra(); return { status, body: new Uint8Array(0) };
    }
    let body: Uint8Array;
    if (transfer !== undefined) {
      const chunks: Uint8Array[] = [];
      let total = 0, overhead = 0;
      for (;;) {
        const sizeLine = await reader.line(1024);
        overhead += sizeLine.length + 2;
        // Bounded RFC token/quoted-string chunk extensions, never interpreted.
        if (!/^[0-9a-fA-F]{1,8}(?:;[!#$%&'*+.^_`|~0-9A-Za-z-]+(?:=(?:[!#$%&'*+.^_`|~0-9A-Za-z-]+|"(?:[\x20-\x21\x23-\x5b\x5d-\x7e]|\\[\x20-\x7e])*"))?)*$/.test(sizeLine)) fail("invalid_response");
        const size = parseInt(sizeLine.split(";")[0], 16);
        if (size === 0) break;
        total += size;
        if (total > MAX_BODY || overhead > MAX_HEADERS) fail("response_too_large");
        chunks.push(await reader.exactly(size));
        const delimiter = await reader.exactly(2);
        if (delimiter[0] !== 13 || delimiter[1] !== 10) fail("invalid_response");
      }
      for (;;) {
        const trailer = await reader.line(MAX_HEADERS - overhead);
        overhead += trailer.length + 2;
        if (!trailer) break;
        const [name] = header(trailer);
        if (["content-length", "transfer-encoding", "content-encoding", "host", "trailer"].includes(name)) fail("invalid_response");
      }
      body = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    } else if (length !== undefined) body = await reader.exactly(Number(length));
    else body = await reader.toEnd();
    reader.noExtra();
    return { status, body };
  }
  return fail("invalid_response");
}

/** One attempt only. All returned errors are fixed codes; never leak remote data. */
export async function deliverMcpEvent(input: unknown, dependencies?: WebhookDependencies): Promise<DeliveryOutcome> {
  let validated: ReturnType<typeof validate>;
  try { validated = validate(input); } catch (error) {
    return { accepted: false, status: null, errorCode: error instanceof DeliveryError ? error.code : "invalid_input" };
  }
  const deps = dependencies ?? defaultDependencies();
  const controller = new AbortController();
  const sockets = new Set<Socket>();
  const deadline = deps.now() + TOTAL_MS;
  let stopped = false;
  const check = () => { if (stopped || controller.signal.aborted || deps.now() >= deadline) fail("timeout"); };
  const closeAll = () => { for (const socket of sockets) safeClose(socket); sockets.clear(); };
  // Acquire wrappers also close late-resolving connect/TLS promises after timeout.
  const acquire = async (promise: Promise<Socket>): Promise<Socket> => {
    const socket = await promise;
    if (stopped || controller.signal.aborted || deps.now() >= deadline) { safeClose(socket); fail("timeout"); }
    sockets.add(socket); return socket;
  };
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = deps.setTimer(() => { stopped = true; controller.abort(); closeAll(); reject(new DeliveryError("timeout")); }, TOTAL_MS);
  });
  const run = async (): Promise<DeliveryOutcome> => {
    check();
    const { url, secret, previousSecret, subscriptionId, event, body } = validated;
    const addresses = (await Promise.all((["A", "AAAA"] as const).map(async (type) => {
      try { return await deps.resolveDns(url.hostname, type, controller.signal); }
      catch (error) {
        // A missing address family is valid; all other DNS failures fail closed.
        if (error instanceof Error && error.name === "NotFound") return [];
        throw new DeliveryError(controller.signal.aborted ? "timeout" : "dns_failed");
      }
    }))).flat();
    check();
    if (!addresses.length) fail("dns_failed");
    if (addresses.length > 64 || addresses.some((ip) => !isPublicAddress(ip))) fail("unsafe_address");
    const raw = await acquire(deps.connect(addresses[0], controller.signal));
    check();
    const secure = await acquire(deps.startTls(raw, url.hostname));
    check();
    if (!secure.handshake) fail("tls_failed");
    await secure.handshake();
    check();
    const id = event.type === "verification" ? `verification_${deps.randomUUID()}` : String(event.eventId);
    const timestamp = String(Math.floor(deps.now() / 1000));
    const signatures = [await signature(secret, id, timestamp, body)];
    if (previousSecret) signatures.push(await signature(previousSecret, id, timestamp, body));
    check();
    const bytes = enc.encode(`POST ${url.pathname}${url.search} HTTP/1.1\r\nHost: ${url.hostname}\r\nContent-Type: application/json\r\nAccept: application/json\r\nAccept-Encoding: identity\r\nConnection: close\r\nContent-Length: ${enc.encode(body).length}\r\nwebhook-id: ${id}\r\nwebhook-timestamp: ${timestamp}\r\nwebhook-signature: ${signatures.join(" ")}\r\nX-MCP-Subscription-Id: ${subscriptionId}\r\n\r\n${body}`);
    let offset = 0;
    while (offset < bytes.length) {
      check();
      const written = await secure.write(bytes.subarray(offset));
      if (!Number.isInteger(written) || written <= 0 || written > bytes.length - offset) fail("transport_failed");
      offset += written;
    }
    check();
    const response = await readResponse(secure, check);
    if (response.status < 200 || response.status >= 300) return { accepted: false, status: response.status, errorCode: "callback_rejected" };
    if (event.type === "verification") {
      let echo: unknown;
      try { echo = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(response.body)); } catch { return { accepted: false, status: response.status, errorCode: "challenge_failed" }; }
      if (!object(echo) || !keys(echo, ["challenge"]) || typeof echo.challenge !== "string" || echo.challenge.length > 256 || !equalChallenge(echo.challenge, String(event.challenge))) {
        return { accepted: false, status: response.status, errorCode: "challenge_failed" };
      }
      return { accepted: true, status: response.status, challenge: String(event.challenge) };
    }
    return { accepted: true, status: response.status };
  };
  try { return await Promise.race([run(), timeout]); }
  catch (error) { return { accepted: false, status: null, errorCode: error instanceof DeliveryError ? error.code : "transport_failed" }; }
  finally { stopped = true; controller.abort(); deps.clearTimer(timer!); closeAll(); }
}

/** Bounded request reader keeps malformed/oversized request data out of outer logs. */
export async function handleMcpEventDelivery(request: Request, dependencies?: WebhookDependencies): Promise<DeliveryOutcome> {
  if (!/^application\/json(?:\s*;.*)?$/i.test(request.headers.get("content-type") || "")) return { accepted: false, status: null, errorCode: "invalid_input" };
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_INPUT)) return { accepted: false, status: null, errorCode: "invalid_input" };
  const reader = request.body?.getReader();
  if (!reader) return { accepted: false, status: null, errorCode: "invalid_input" };
  const chunks: Uint8Array[] = [];
  let size = 0, timedOut = false;
  const timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, TOTAL_MS);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_INPUT) return { accepted: false, status: null, errorCode: "invalid_input" };
      chunks.push(value);
    }
    if (timedOut) return { accepted: false, status: null, errorCode: "timeout" };
    clearTimeout(timer);
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
    const input = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    return await deliverMcpEvent(input, dependencies);
  } catch { return { accepted: false, status: null, errorCode: "invalid_input" }; }
  finally { clearTimeout(timer); void reader.cancel().catch(() => {}); reader.releaseLock(); }
}
