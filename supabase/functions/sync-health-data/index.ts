import { healthUserId } from "../_shared/env.ts";
import { assertSharedSecret, jsonResponse } from "../_shared/http.ts";
import { getUsableToken, syncHealthData } from "../_shared/health_api.ts";
import { createAdminClient } from "../_shared/supabase.ts";

function bangkokDate(daysAgo: number): string {
  const date = new Date(Date.now() - daysAgo * 86400000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function refreshActivityRollups(supabase: ReturnType<typeof createAdminClient>, userId: string): Promise<void> {
  const results = await Promise.all(Array.from({ length: 7 }, (_, daysAgo) =>
    supabase.rpc("refresh_health_activity_daily_rollup", {
      p_user_id: userId,
      p_activity_date: bangkokDate(daysAgo),
    })
  ));
  const error = results.find((result) => result.error)?.error;
  if (error) throw new Error(`Failed to refresh activity rollups: ${error.message}`);
}

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
      await refreshActivityRollups(supabase, userId);
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
