import { healthUserId } from "../_shared/env.ts";
import { assertSharedSecret, jsonResponse } from "../_shared/http.ts";
import { getUsableToken, syncHealthData } from "../_shared/health_api.ts";
import { createAdminClient } from "../_shared/supabase.ts";

Deno.serve(async (req) => {
  let recordsSynced = 0;
  const userId = healthUserId();
  const supabase = createAdminClient();

  try {
    if (req.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    assertSharedSecret(req);

    const requestBody = await req.json().catch(() => ({}));
    const refreshOnly = requestBody.refresh_only === true;
    const token = await getUsableToken(supabase);

    if (!refreshOnly) {
      recordsSynced = await syncHealthData(supabase, token);
    }

    const { error: logError } = await supabase.from("sync_logs").insert({
      user_id: userId,
      status: "success",
      records_synced: recordsSynced,
    });

    if (logError) {
      console.error(`Failed to write sync log: ${logError.message}`);
    }

    return jsonResponse({
      status: "success",
      records_synced: recordsSynced,
      refresh_only: refreshOnly,
    });
  } catch (error) {
    if (error instanceof Response) {
      return error;
    }

    const message = error instanceof Error ? error.message : String(error);
    console.error(error);

    const { error: logError } = await supabase.from("sync_logs").insert({
      user_id: userId,
      status: "error",
      error_message: message,
      records_synced: recordsSynced,
    });

    if (logError) {
      console.error(`Failed to write error sync log: ${logError.message}`);
    }

    return jsonResponse({
      status: "error",
      error: message,
      records_synced: recordsSynced,
    }, 500);
  }
});

