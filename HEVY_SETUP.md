# AI Health + Hevy deployment handoff

The Supabase schema and Edge Functions are deployed. The Google Health sync remains active every 30 minutes.

## Required secrets

Add these in Supabase Dashboard → Project Settings → Edge Functions → Secrets:

- `HEVY_API_KEY`: Hevy Pro developer API key.
- `HEVY_ACTIONS_API_KEY`: a separate long random bearer secret for the private GPT Action.

Existing secrets used by both cloud sync systems:

- `HEALTH_USER_ID`
- `SYNC_SHARED_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

Never put the Hevy key or Supabase service-role key in ChatGPT.

## First import

After adding secrets, call `sync-hevy-data` with:

```http
POST https://wgolwcojpqydgtlfyjko.supabase.co/functions/v1/sync-hevy-data
Authorization: Bearer <SYNC_SHARED_SECRET>
Content-Type: application/json

{"full":true}
```

Verify `hevy_sync_logs`, `hevy_workouts`, `hevy_workout_exercises`, and `hevy_workout_sets` before enabling schedules.

## Schedules

Run these only after the full import succeeds:

```sql
select cron.schedule(
  'sync-hevy-data-every-30-minutes',
  '*/30 * * * *',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='health_project_url') || '/functions/v1/sync-hevy-data',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='health_sync_shared_secret')
    ),
    body := jsonb_build_object('full',false,'source','pg_cron','scheduled_at',now())
  );
  $job$
);

select cron.schedule(
  'sync-hevy-data-weekly-reconcile',
  '17 3 * * 0',
  $job$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='health_project_url') || '/functions/v1/sync-hevy-data',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='health_sync_shared_secret')
    ),
    body := jsonb_build_object('full',true,'source','pg_cron_weekly','scheduled_at',now())
  );
  $job$
);
```

The weekly schedule is 03:17 UTC Sunday, or 10:17 Bangkok.

## Custom GPT

Create or edit the GPT on ChatGPT web:

1. Import `hevy-gpt-actions.openapi.yaml` under Actions.
2. Choose API-key authentication, Bearer.
3. Enter only `HEVY_ACTIONS_API_KEY`.
4. Add instructions to use Asia/Bangkok, kilograms, request confirmation before writes, and avoid medical diagnosis.
5. Test read actions, then a user-approved test workout.
6. Open the custom GPT from the ChatGPT mobile sidebar.

The GPT Actions API is:

`https://wgolwcojpqydgtlfyjko.supabase.co/functions/v1/hevy-actions`
