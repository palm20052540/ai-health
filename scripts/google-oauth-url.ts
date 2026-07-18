import { GOOGLE_HEALTH_SCOPES } from "../supabase/functions/_shared/env.ts";

const clientId = Deno.env.get("GOOGLE_CLIENT_ID");
const redirectUri = Deno.env.get("GOOGLE_REDIRECT_URI");
const state = Deno.env.get("GOOGLE_OAUTH_STATE");

if (!clientId || !redirectUri || !state) {
  console.error("Missing GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI, or GOOGLE_OAUTH_STATE.");
  Deno.exit(1);
}

const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
url.searchParams.set("client_id", clientId);
url.searchParams.set("redirect_uri", redirectUri);
url.searchParams.set("response_type", "code");
url.searchParams.set("access_type", "offline");
url.searchParams.set("prompt", "consent");
url.searchParams.set("state", state);
url.searchParams.set("scope", GOOGLE_HEALTH_SCOPES.join(" "));

console.log(url.toString());

