import { createClient } from "npm:@supabase/supabase-js@2.110.2";
import { requiredEnv, serviceRoleKey } from "./env.ts";

export function createAdminClient() {
  return createClient(
    requiredEnv("SUPABASE_URL"),
    serviceRoleKey(),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}
