# Google Health API to Supabase Pipeline

Personal Supabase-native pipeline for syncing Google Health API data from Fitbit or Pixel Watch into queryable Postgres tables.

## Important Google Health API Access Note

Google Health API scopes are Restricted scopes. You can test an unverified OAuth app with manually added test users, but a public production launch, or support beyond the 100-user unverified cap, requires Google OAuth verification and a third-party security assessment.

This project requests only read scopes:

- `https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly`
- `https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly`
- `https://www.googleapis.com/auth/googlehealth.sleep.readonly`

## Schema

The migration creates:

- `health_tokens`: one token row per `user_id`.
- `health_metrics`: flexible `jsonb` metric rows keyed by `(user_id, data_type, recorded_at, source)`.
- `sync_logs`: one row per sync attempt.

RLS is enabled on all three tables. Authenticated users can read only rows where `auth.uid() = user_id`. Edge Functions use `SUPABASE_SERVICE_ROLE_KEY` for writes.

For v1, OAuth tokens are stored directly in `health_tokens.access_token` and `health_tokens.refresh_token`. This relies on Supabase/Postgres infrastructure encryption at rest, not app-level Vault-backed token storage. A later hardening pass can replace token columns with Supabase Vault secret references.

## Google Cloud Setup

1. Create or choose a Google Cloud project.
2. Enable the Google Health API.
3. Configure the OAuth consent screen as External.
4. While unverified, add your Google account under Test users.
5. Create a Web Application OAuth client.
6. Add this redirect URI:

   ```text
   https://your-project-ref.supabase.co/functions/v1/oauth-callback
   ```

7. Add the three Google Health read scopes listed above under Data Access.

To generate the authorization URL, use your actual values:

```text
https://accounts.google.com/o/oauth2/v2/auth?client_id=GOOGLE_CLIENT_ID&redirect_uri=GOOGLE_REDIRECT_URI&response_type=code&access_type=offline&prompt=consent&state=GOOGLE_OAUTH_STATE&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgooglehealth.activity_and_fitness.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgooglehealth.health_metrics_and_measurements.readonly%20https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fgooglehealth.sleep.readonly
```

Use `prompt=consent` when you need Google to issue a refresh token or when scopes change.

After filling your env file, you can also generate the URL with:

```bash
npm run oauth:url
```

## Environment Variables

Copy `.env.example` to your local env file and fill in real values:

```bash
cp .env.example supabase/functions/.env
```

Required:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` locally. The deploy helper maps this to `SERVICE_ROLE_KEY` for Edge Functions because Supabase does not allow custom secrets starting with `SUPABASE_`.
- `HEALTH_USER_ID`
- `GOOGLE_OAUTH_STATE`
- `SYNC_SHARED_SECRET`

Optional:

- `HEALTH_SOURCE`, defaults to `google_health`; use `fitbit` or `pixel_watch` if you want the source label to match your device path.
- `SYNC_WINDOW_DAYS`, defaults to `7`.
- `SYNC_FUNCTION_URL`, used by the manual script when not calling the deployed function URL.

Never commit real `.env` files.

## Local Development

Install the Supabase CLI and Deno, then run:

```bash
supabase start
supabase db reset
supabase functions serve oauth-callback sync-health-data --env-file supabase/functions/.env
```

Manual sync against a deployed or locally served function:

```bash
deno run --allow-env --allow-net scripts/sync-health-data.ts
```

Refresh-only check:

```bash
deno run --allow-env --allow-net scripts/sync-health-data.ts --refresh-only
```

## Deploy

Link your Supabase project, deploy secrets, apply migrations, and deploy functions:

```bash
supabase link --project-ref your-project-ref
supabase secrets set --env-file supabase/functions/.env
supabase db push
supabase functions deploy oauth-callback
supabase functions deploy sync-health-data
```

Or run the deploy helper from PowerShell:

```powershell
.\scripts\deploy.ps1 -EnvFile .env
```

## Scheduling

The migration schedules `sync-health-data` every 30 minutes using `pg_cron` and `pg_net`.

Before the scheduled job can call the function, store these secrets in Supabase Vault:

```sql
select vault.create_secret('https://your-project-ref.supabase.co', 'health_project_url');
select vault.create_secret('your-sync-shared-secret', 'health_sync_shared_secret');
```

The Edge Function has Supabase JWT verification disabled in `supabase/config.toml` and validates `Authorization: Bearer ${SYNC_SHARED_SECRET}` itself.

## AI Health Plugin And Custom GPT

The Custom GPT and personal Codex plugin run side by side against the same `hevy-actions` Edge Function. Legacy GPT Action routes remain available, while compact `/v1` routes return aggregate evidence with freshness and coverage metadata:

- `GET /v1/daily-state`
- `GET /v1/health-recap?days=28`
- `GET /v1/workout-progress?days=28`
- `GET /v1/data-freshness`
- `GET /v1/portal-dashboard?days=30` (single-request payload for the personal portal)
- `POST /v1/sync-missing-data` (Codex plugin key only)

The personal plugin lives at `C:\Users\ASUS\plugins\ai-health`. It reads `AI_HEALTH_API_URL` and `AI_HEALTH_PLUGIN_API_KEY` from the user environment and never receives the Supabase service-role key. The sync tool uses a 15-minute per-source cooldown and an atomic database guard, so repeated calls do not repeatedly hit Hevy or Google Health.

## Tong Fit portal and GPT Sites

The mobile-first React portal uses a same-origin Worker proxy, so its API credential is never shipped to the browser. In Supabase, configure a dedicated `AI_HEALTH_SITE_API_KEY`; in GPT Sites, store that same value under the Worker's `AI_HEALTH_PLUGIN_API_KEY` binding. This keeps the Site credential separate from the Codex plugin credential. The portal requests one cached dashboard payload per selected range and only calls `/v1/sync-missing-data` when the user taps **Sync now**.

For local development, copy `.dev.vars.example` to `.dev.vars` or provide the same values through process environment variables. For GPT Sites, add these hosted secrets in the Site settings before deployment:

- `AI_HEALTH_API_URL`
- `AI_HEALTH_PLUGIN_API_KEY`
- `ALLOWED_USER_EMAIL` (recommended defense in depth; use the email that opens the private Site)

Run `npm run build` to create the GPT Sites-compatible Worker and client bundle. The official Sites packaging metadata is generated at `dist/.openai/hosting.json`. Keep the Site audience owner-only.

For 28-day Custom GPT recaps, prefer `getCompactHealthRecap` from `hevy-gpt-actions.openapi.yaml`. The legacy `compareTrainingAndRecovery` operation remains available for rollback but returns raw records and is not intended for routine recaps.

## Synced Data Types

Initial data types:

- `exercise` (session-aware workout records, including source-provided summary calories when present)
- `steps`
- `sleep`
- `heart-rate`
- `workout-heart-rate` (one-minute measured rollups only inside completed Hevy workout windows)
- `workout-active-energy-burned` (one-minute measured rollups only inside completed Hevy workout windows)
- `workout-source-reported-calories` (source summary captured at the workout start; used as trend context, never interpreted as a one-minute burn rate)
- `daily-heart-rate-variability`
- `daily-resting-heart-rate`
- `active-zone-minutes`
- `weight`

The sync uses Google Health API v4 data type names and stores raw response objects in `health_metrics.value`.

Completed Hevy workouts also receive measured-only physiology summaries in
`workout_health_summaries`. Calculations include only source intervals fully contained within
the workout window. The physiology endpoint also matches Google Health `exercise` sessions
with at least 75% temporal overlap and exposes session calories only when the source record
contains them. Source-reported workout calories are the default user-facing calorie value when
present. Overlapping active energy remains stored internally for technical audits, is omitted
from the normal Action response, and is not used for deficit calculations; no exercise or set
timestamps are inferred.

## Token Refresh Flow

`sync-health-data` loads the token row for `HEALTH_USER_ID`. If `expires_at` is within five minutes, it calls Google OAuth's token endpoint with the stored refresh token, updates `access_token`, `expires_at`, and `oauth_scope`, then continues syncing. Calling the function with `{"refresh_only": true}` performs only the token freshness check and refresh.

## Ambiguities And Assumptions

- Google Health response schemas vary by data type, so metric values are stored as raw `jsonb`.
- `recorded_at` is extracted from the first recognizable physical, civil, sample, interval, or daily date field in each response object.
- `HEALTH_USER_ID` is a fixed Supabase Auth user UUID for now. The schema includes `user_id` on metrics and logs so the RLS pattern remains correct.
- Token storage is intentionally the easiest v1 path: direct table columns, no hardcoded secrets. Supabase Vault is used for cron invocation secrets, not OAuth token storage.
