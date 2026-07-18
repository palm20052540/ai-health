import { healthUserId } from "../_shared/env.ts";
import { exchangeCodeForTokens, expiresAtFromNow, requestedScopeString } from "../_shared/google_oauth.ts";
import { jsonResponse } from "../_shared/http.ts";
import { createAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  try {
    if (req.method !== "GET") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const expectedState = Deno.env.get("GOOGLE_OAUTH_STATE");

    if (!code) {
      return jsonResponse({ error: "Missing OAuth code" }, 400);
    }

    if (!expectedState || state !== expectedState) {
      return jsonResponse({ error: "Invalid OAuth state" }, 400);
    }

    const tokens = await exchangeCodeForTokens(code);
    const supabase = createAdminClient();
    const userId = healthUserId();

    const { data: existing } = await supabase
      .from("health_tokens")
      .select("refresh_token")
      .eq("user_id", userId)
      .maybeSingle();

    const refreshToken = tokens.refresh_token || existing?.refresh_token;
    if (!refreshToken) {
      return jsonResponse({
        error: "Google did not return a refresh token. Re-authorize with access_type=offline and prompt=consent.",
      }, 400);
    }

    const { error } = await supabase
      .from("health_tokens")
      .upsert({
        user_id: userId,
        access_token: tokens.access_token,
        refresh_token: refreshToken,
        expires_at: expiresAtFromNow(tokens.expires_in),
        oauth_scope: tokens.scope || requestedScopeString(),
      }, {
        onConflict: "user_id",
      });

    if (error) {
      throw new Error(`Failed to upsert health token: ${error.message}`);
    }

    return jsonResponse({
      status: "ok",
      message: "Google Health OAuth tokens stored.",
      user_id: userId,
      scope: tokens.scope || requestedScopeString(),
    });
  } catch (error) {
    console.error(error);
    return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

