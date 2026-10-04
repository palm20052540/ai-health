import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";

import { drainWorkoutEvents } from "../hevy-actions/workoutEvents.ts";

const HEVY_BASE = "https://api.hevyapp.com/v1";
const PAGE_SIZE = 10;

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authorize(req: Request): void {
  const expected = required("SYNC_SHARED_SECRET");
  if (req.headers.get("Authorization") !== `Bearer ${expected}`) {
    throw new Response("Unauthorized", { status: 401 });
  }
}

function admin(): SupabaseClient {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function hevy(path: string, init: RequestInit = {}): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const result = await fetch(`${HEVY_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: {
        "api-key": required("HEVY_API_KEY"),
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
    });
    const body = await result.json().catch(() => ({}));
    if (!result.ok) {
      throw new Error(`Hevy API ${result.status} for ${path}: ${JSON.stringify(body)}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

async function allPages(path: string, key: string): Promise<any[]> {
  const values: any[] = [];
  let page = 1;
  while (true) {
    const join = path.includes("?") ? "&" : "?";
    const body = await hevy(`${path}${join}page=${page}&pageSize=${PAGE_SIZE}`);
    values.push(...(Array.isArray(body[key]) ? body[key] : []));
    const pageCount = Number(body.page_count || page);
    if (page >= pageCount) break;
    page += 1;
  }
  return values;
}

async function replaceWorkout(db: SupabaseClient, userId: string, workout: any): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from("hevy_workouts").upsert({
    id: String(workout.id),
    user_id: userId,
    routine_id: workout.routine_id ? String(workout.routine_id) : null,
    title: String(workout.title || "Workout"),
    description: workout.description ?? null,
    start_time: workout.start_time,
    end_time: workout.end_time,
    hevy_created_at: workout.created_at ?? null,
    hevy_updated_at: workout.updated_at ?? null,
    deleted_at: null,
    raw_payload: workout,
    synced_at: now,
  }, { onConflict: "id,user_id" });
  if (error) throw new Error(`Workout upsert failed: ${error.message}`);

  const { error: deleteError } = await db.from("hevy_workout_exercises")
    .delete().eq("workout_id", String(workout.id)).eq("user_id", userId);
  if (deleteError) throw new Error(`Workout exercise replace failed: ${deleteError.message}`);

  const exercises = Array.isArray(workout.exercises) ? workout.exercises : [];
  for (let exerciseIndex = 0; exerciseIndex < exercises.length; exerciseIndex += 1) {
    const exercise = exercises[exerciseIndex];
    const index = Number(exercise.index ?? exerciseIndex);
    const { error: exerciseError } = await db.from("hevy_workout_exercises").insert({
      workout_id: String(workout.id),
      user_id: userId,
      exercise_index: index,
      exercise_template_id: exercise.exercise_template_id ? String(exercise.exercise_template_id) : null,
      title: String(exercise.title || "Exercise"),
      notes: exercise.notes ?? null,
      superset_id: exercise.supersets_id ?? exercise.superset_id ?? null,
      raw_payload: exercise,
    });
    if (exerciseError) throw new Error(`Workout exercise insert failed: ${exerciseError.message}`);

    const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
    if (sets.length) {
      const rows = sets.map((set: any, setIndex: number) => ({
        workout_id: String(workout.id),
        user_id: userId,
        exercise_index: index,
        set_index: Number(set.index ?? setIndex),
        set_type: set.type ?? null,
        weight_kg: set.weight_kg ?? null,
        reps: set.reps ?? null,
        distance_meters: set.distance_meters ?? null,
        duration_seconds: set.duration_seconds ?? null,
        rpe: set.rpe ?? null,
        custom_metric: set.custom_metric ?? null,
        raw_payload: set,
      }));
      const { error: setError } = await db.from("hevy_workout_sets").insert(rows);
      if (setError) throw new Error(`Workout set insert failed: ${setError.message}`);
    }
  }
}

async function replaceRoutine(db: SupabaseClient, userId: string, routine: any): Promise<void> {
  const { error } = await db.from("hevy_routines").upsert({
    id: String(routine.id),
    user_id: userId,
    folder_id: routine.folder_id ?? null,
    title: String(routine.title || "Routine"),
    hevy_created_at: routine.created_at ?? null,
    hevy_updated_at: routine.updated_at ?? null,
    raw_payload: routine,
    synced_at: new Date().toISOString(),
  }, { onConflict: "id,user_id" });
  if (error) throw new Error(`Routine upsert failed: ${error.message}`);

  const { error: deleteError } = await db.from("hevy_routine_exercises")
    .delete().eq("routine_id", String(routine.id)).eq("user_id", userId);
  if (deleteError) throw new Error(`Routine exercise replace failed: ${deleteError.message}`);

  const exercises = Array.isArray(routine.exercises) ? routine.exercises : [];
  for (let exerciseIndex = 0; exerciseIndex < exercises.length; exerciseIndex += 1) {
    const exercise = exercises[exerciseIndex];
    const index = Number(exercise.index ?? exerciseIndex);
    const { error: exerciseError } = await db.from("hevy_routine_exercises").insert({
      routine_id: String(routine.id),
      user_id: userId,
      exercise_index: index,
      exercise_template_id: exercise.exercise_template_id ? String(exercise.exercise_template_id) : null,
      title: String(exercise.title || "Exercise"),
      rest_seconds: exercise.rest_seconds ?? null,
      notes: exercise.notes ?? null,
      superset_id: exercise.supersets_id ?? exercise.superset_id ?? null,
      raw_payload: exercise,
    });
    if (exerciseError) throw new Error(`Routine exercise insert failed: ${exerciseError.message}`);

    const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
    if (sets.length) {
      const rows = sets.map((set: any, setIndex: number) => ({
        routine_id: String(routine.id),
        user_id: userId,
        exercise_index: index,
        set_index: Number(set.index ?? setIndex),
        set_type: set.type ?? null,
        weight_kg: set.weight_kg ?? null,
        reps: set.reps ?? null,
        rep_range_start: set.rep_range?.start ?? null,
        rep_range_end: set.rep_range?.end ?? null,
        distance_meters: set.distance_meters ?? null,
        duration_seconds: set.duration_seconds ?? null,
        rpe: set.rpe ?? null,
        custom_metric: set.custom_metric ?? null,
        raw_payload: set,
      }));
      const { error: setError } = await db.from("hevy_routine_sets").insert(rows);
      if (setError) throw new Error(`Routine set insert failed: ${setError.message}`);
    }
  }
}

async function fullSync(db: SupabaseClient, userId: string): Promise<number> {
  let processed = 0;
  const info = await hevy("/user/info");
  const profile = info.data || info;
  const { error: accountError } = await db.from("hevy_accounts").upsert({
    user_id: userId,
    hevy_user_id: profile.id ? String(profile.id) : null,
    display_name: profile.name ?? null,
    profile_url: profile.url ?? null,
    raw_payload: profile,
    synced_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (accountError) throw new Error(`Hevy account upsert failed: ${accountError.message}`);

  const folders = await allPages("/routine_folders", "routine_folders");
  if (folders.length) {
    const { error } = await db.from("hevy_routine_folders").upsert(folders.map((folder: any) => ({
      id: Number(folder.id),
      user_id: userId,
      folder_index: folder.index ?? null,
      title: String(folder.title || "Folder"),
      hevy_created_at: folder.created_at ?? null,
      hevy_updated_at: folder.updated_at ?? null,
      raw_payload: folder,
      synced_at: new Date().toISOString(),
    })), { onConflict: "id,user_id" });
    if (error) throw new Error(`Folder upsert failed: ${error.message}`);
  }
  processed += folders.length;

  const templates = await allPages("/exercise_templates", "exercise_templates");
  if (templates.length) {
    const { error } = await db.from("hevy_exercise_templates").upsert(templates.map((item: any) => ({
      id: String(item.id),
      user_id: userId,
      title: String(item.title || "Exercise"),
      exercise_type: item.type ?? null,
      primary_muscle_group: item.primary_muscle_group ?? null,
      secondary_muscle_groups: item.secondary_muscle_groups || [],
      equipment_category: item.equipment_category ?? null,
      is_custom: item.is_custom === true,
      raw_payload: item,
      synced_at: new Date().toISOString(),
    })), { onConflict: "id" });
    if (error) throw new Error(`Exercise template upsert failed: ${error.message}`);
  }
  processed += templates.length;

  const routines = await allPages("/routines", "routines");
  for (const routine of routines) await replaceRoutine(db, userId, routine);
  processed += routines.length;

  const workouts = await allPages("/workouts", "workouts");
  for (const workout of workouts) await replaceWorkout(db, userId, workout);
  processed += workouts.length;

  const measurements = await allPages("/body_measurements", "body_measurements");
  if (measurements.length) {
    const { error } = await db.from("hevy_body_measurements").upsert(measurements.map((item: any) => ({
      user_id: userId,
      measurement_date: item.date,
      weight_kg: item.weight_kg ?? null,
      lean_mass_kg: item.lean_mass_kg ?? null,
      fat_percent: item.fat_percent ?? null,
      measurements: item,
      raw_payload: item,
      synced_at: new Date().toISOString(),
    })), { onConflict: "user_id,measurement_date" });
    if (error) throw new Error(`Measurement upsert failed: ${error.message}`);
  }
  processed += measurements.length;
  return processed;
}

async function incrementalWorkouts(db: SupabaseClient, userId: string, since: string): Promise<number> {
  const events = await allPages(`/workouts/events?since=${encodeURIComponent(since)}`, "events");
  for (const event of events.reverse()) {
    if (event.type === "deleted") {
      const { error } = await db.from("hevy_workouts").update({
        deleted_at: event.deleted_at || new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }).eq("id", String(event.id)).eq("user_id", userId);
      if (error) throw new Error(`Workout deletion sync failed: ${error.message}`);
    } else if (event.workout) {
      await replaceWorkout(db, userId, event.workout);
    }
  }
  return events.length;
}

Deno.serve(async (req) => {
  const db = admin();
  const userId = required("HEALTH_USER_ID");
  const startedAt = new Date().toISOString();
  let logId: string | null = null;
  let processed = 0;
  try {
    if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
    authorize(req);
    const input = await req.json().catch(() => ({}));
    const { data: log } = await db.from("hevy_sync_logs").insert({
      user_id: userId, sync_type: input.full === true ? "full" : "incremental",
      status: "success", started_at: startedAt,
    }).select("id").single();
    logId = log?.id || null;

    const { data: state, error: stateReadError } = await db.from("hevy_sync_state")
      .select("cursor").eq("user_id", userId).eq("resource", "workouts").maybeSingle();
    if (stateReadError) throw new Error("Sync cursor unavailable");
    const full = input.full === true || !state?.cursor;
    if (full) {
      processed = await fullSync(db, userId);
    } else {
      const overlap = new Date(new Date(state.cursor).getTime() - 5 * 60 * 1000).toISOString();
      processed = await incrementalWorkouts(db, userId, overlap);
    }

    const completedAt = new Date().toISOString();
    const { error: stateWriteError } = await db.from("hevy_sync_state").upsert({
      user_id: userId, resource: "workouts", cursor: startedAt,
      last_success_at: completedAt, last_error: null,
      metadata: { last_mode: full ? "full" : "incremental", records_processed: processed },
      updated_at: completedAt,
    }, { onConflict: "user_id,resource" });
    if (stateWriteError) throw new Error("Completed import marker could not be saved");
    if (logId) await db.from("hevy_sync_logs").update({
      records_processed: processed, completed_at: completedAt,
      details: { mode: full ? "full" : "incremental" },
    }).eq("id", logId);
    // Source import success and chat delivery are independent. A failed delivery
    // remains durably queued for a later existing import, without repeating analysis.
    try { await drainWorkoutEvents(db, userId); } catch { console.warn("Workout recap delivery remains pending"); }
    return response({ status: "success", mode: full ? "full" : "incremental", records_processed: processed });
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    if (logId) await db.from("hevy_sync_logs").update({
      status: "error", error_message: message, completed_at: new Date().toISOString(),
      records_processed: processed,
    }).eq("id", logId);
    await db.from("hevy_sync_state").upsert({
      user_id: userId, resource: "workouts", last_error: message, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id,resource" });
    console.error(message);
    return response({ status: "error", error: message }, 500);
  }
});
