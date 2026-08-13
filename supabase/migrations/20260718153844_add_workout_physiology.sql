create table if not exists public.workout_health_summaries (
  workout_id text not null,
  user_id uuid not null,
  workout_start timestamptz not null,
  workout_end timestamptz not null,
  heart_rate_sample_count integer not null default 0,
  heart_rate_covered_seconds integer not null default 0,
  heart_rate_coverage_percent numeric(5,2) not null default 0,
  average_heart_rate_bpm numeric(7,2),
  minimum_heart_rate_bpm numeric(7,2),
  maximum_heart_rate_bpm numeric(7,2),
  heart_rate_drift_bpm numeric(7,2),
  active_calories_kcal numeric(10,2),
  total_calories_kcal numeric(10,2),
  active_calorie_sample_count integer not null default 0,
  total_calorie_sample_count integer not null default 0,
  data_quality text not null check (data_quality in ('complete', 'partial', 'missing')),
  source_synced_at timestamptz,
  computed_at timestamptz not null default now(),
  primary key (workout_id, user_id),
  constraint workout_health_summaries_workout_fkey
    foreign key (workout_id, user_id)
    references public.hevy_workouts (id, user_id)
    on delete cascade
);

create index if not exists workout_health_summaries_user_start_idx
  on public.workout_health_summaries (user_id, workout_start desc);

create index if not exists health_metrics_user_type_recorded_idx
  on public.health_metrics (user_id, data_type, recorded_at desc);

alter table public.workout_health_summaries enable row level security;

drop policy if exists "Users can read own workout health summaries"
  on public.workout_health_summaries;
create policy "Users can read own workout health summaries"
  on public.workout_health_summaries
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

grant select on public.workout_health_summaries to authenticated;
grant select, insert, update, delete on public.workout_health_summaries to service_role;
