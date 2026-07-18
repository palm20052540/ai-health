export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

export function assertSharedSecret(req: Request): void {
  const expected = Deno.env.get("SYNC_SHARED_SECRET");
  if (!expected) {
    throw new Error("Missing required environment variable: SYNC_SHARED_SECRET");
  }

  const authorization = req.headers.get("Authorization") || "";
  if (authorization !== `Bearer ${expected}`) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

