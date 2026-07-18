export const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
];

export function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function optionalEnv(name: string, fallback: string): string {
  return Deno.env.get(name) || fallback;
}

export function healthUserId(): string {
  return requiredEnv("HEALTH_USER_ID");
}

export function serviceRoleKey(): string {
  const value = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");
  if (!value) {
    throw new Error("Missing required environment variable: SERVICE_ROLE_KEY");
  }
  return value;
}

export function healthSource(): string {
  return optionalEnv("HEALTH_SOURCE", "google_health");
}

export function syncWindowDays(): number {
  const raw = optionalEnv("SYNC_WINDOW_DAYS", "7");
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 7;
  }
  return Math.min(parsed, 90);
}
