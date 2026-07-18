const supabaseUrl = Deno.env.get("SUPABASE_URL");
const sharedSecret = Deno.env.get("SYNC_SHARED_SECRET");
const functionUrl = Deno.env.get("SYNC_FUNCTION_URL") ||
  (supabaseUrl ? `${supabaseUrl}/functions/v1/sync-health-data` : undefined);

if (!functionUrl || !sharedSecret) {
  console.error("Missing SUPABASE_URL or SYNC_FUNCTION_URL, and SYNC_SHARED_SECRET.");
  Deno.exit(1);
}

const refreshOnly = Deno.args.includes("--refresh-only");

const response = await fetch(functionUrl, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${sharedSecret}`,
  },
  body: JSON.stringify({ source: "manual-script", refresh_only: refreshOnly }),
});

const body = await response.text();
console.log(body);

if (!response.ok) {
  Deno.exit(1);
}

