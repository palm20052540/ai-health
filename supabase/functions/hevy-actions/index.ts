import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.2";

const HEVY_BASE = "https://api.hevyapp.com/v1";

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function admin(): SupabaseClient {
  return createClient(required("SUPABASE_URL"), required("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

type Caller = "custom_gpt" | "codex_plugin";

function authorize(req: Request): Caller {
  const supplied = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const pluginKey = Deno.env.get("AI_HEALTH_PLUGIN_API_KEY");
  if (pluginKey && supplied === pluginKey) return "codex_plugin";
  const siteKey = Deno.env.get("AI_HEALTH_SITE_API_KEY");
  if (siteKey && supplied === siteKey) return "codex_plugin";
  if (supplied && supplied === required("HEVY_ACTIONS_API_KEY")) return "custom_gpt";
  throw new Response("Unauthorized", { status: 401 });
}

async function hevy(path: string, init: RequestInit = {}): Promise<any> {
  const result = await fetch(`${HEVY_BASE}${path}`, {
    ...init,
    headers: {
      "api-key": required("HEVY_API_KEY"),
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const body = await result.json().catch(() => ({}));
  if (!result.ok) throw new Error(`Hevy API ${result.status}: ${JSON.stringify(body)}`);
  return body;
}

function pathAfterFunction(url: string): string[] {
  const parts = new URL(url).pathname.split("/").filter(Boolean);
  const position = parts.indexOf("hevy-actions");
  return position >= 0 ? parts.slice(position + 1) : parts;
}

async function hash(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
}

async function cacheWorkout(db: SupabaseClient, userId: string, workout: any): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from("hevy_workouts").upsert({
    id: String(workout.id), user_id: userId,
    routine_id: workout.routine_id ? String(workout.routine_id) : null,
    title: String(workout.title || "Workout"), description: workout.description ?? null,
    start_time: workout.start_time, end_time: workout.end_time,
    hevy_created_at: workout.created_at ?? null, hevy_updated_at: workout.updated_at ?? null,
    deleted_at: null, raw_payload: workout, synced_at: now,
  }, { onConflict: "id,user_id" });
  if (error) throw new Error(error.message);

  await db.from("hevy_workout_exercises").delete()
    .eq("workout_id", String(workout.id)).eq("user_id", userId);
  const exercises = Array.isArray(workout.exercises) ? workout.exercises : [];
  for (let i = 0; i < exercises.length; i += 1) {
    const exercise = exercises[i];
    const exerciseIndex = Number(exercise.index ?? i);
    const { error: exerciseError } = await db.from("hevy_workout_exercises").insert({
      workout_id: String(workout.id), user_id: userId, exercise_index: exerciseIndex,
      exercise_template_id: exercise.exercise_template_id ? String(exercise.exercise_template_id) : null,
      title: String(exercise.title || "Exercise"), notes: exercise.notes ?? null,
      superset_id: exercise.supersets_id ?? exercise.superset_id ?? null, raw_payload: exercise,
    });
    if (exerciseError) throw new Error(exerciseError.message);
    const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
    if (sets.length) {
      const { error: setError } = await db.from("hevy_workout_sets").insert(sets.map((set: any, j: number) => ({
        workout_id: String(workout.id), user_id: userId, exercise_index: exerciseIndex,
        set_index: Number(set.index ?? j), set_type: set.type ?? null,
        weight_kg: set.weight_kg ?? null, reps: set.reps ?? null,
        distance_meters: set.distance_meters ?? null, duration_seconds: set.duration_seconds ?? null,
        rpe: set.rpe ?? null, custom_metric: set.custom_metric ?? null, raw_payload: set,
      })));
      if (setError) throw new Error(setError.message);
    }
  }
}

async function cacheRoutine(db: SupabaseClient, userId: string, routine: any): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await db.from("hevy_routines").upsert({
    id: String(routine.id), user_id: userId,
    folder_id: routine.folder_id ?? null,
    title: String(routine.title || "Routine"),
    hevy_created_at: routine.created_at ?? null,
    hevy_updated_at: routine.updated_at ?? null,
    raw_payload: routine, synced_at: now,
  }, { onConflict: "id,user_id" });
  if (error) throw new Error(error.message);

  await db.from("hevy_routine_exercises").delete()
    .eq("routine_id", String(routine.id)).eq("user_id", userId);
  const exercises = Array.isArray(routine.exercises) ? routine.exercises : [];
  for (let i = 0; i < exercises.length; i += 1) {
    const exercise = exercises[i];
    const exerciseIndex = Number(exercise.index ?? i);
    const { error: exerciseError } = await db.from("hevy_routine_exercises").insert({
      routine_id: String(routine.id), user_id: userId, exercise_index: exerciseIndex,
      exercise_template_id: exercise.exercise_template_id ? String(exercise.exercise_template_id) : null,
      title: String(exercise.title || "Exercise"), rest_seconds: exercise.rest_seconds ?? null,
      notes: exercise.notes ?? null, superset_id: exercise.supersets_id ?? exercise.superset_id ?? null,
      raw_payload: exercise,
    });
    if (exerciseError) throw new Error(exerciseError.message);
    const sets = Array.isArray(exercise.sets) ? exercise.sets : [];
    if (sets.length) {
      const { error: setError } = await db.from("hevy_routine_sets").insert(sets.map((set: any, j: number) => ({
        routine_id: String(routine.id), user_id: userId, exercise_index: exerciseIndex,
        set_index: Number(set.index ?? j), set_type: set.type ?? null,
        weight_kg: set.weight_kg ?? null, reps: set.reps ?? null,
        rep_range_start: set.rep_range?.start ?? null, rep_range_end: set.rep_range?.end ?? null,
        distance_meters: set.distance_meters ?? null, duration_seconds: set.duration_seconds ?? null,
        rpe: set.rpe ?? null, custom_metric: set.custom_metric ?? null, raw_payload: set,
      })));
      if (setError) throw new Error(setError.message);
    }
  }
}

async function workoutDetail(db: SupabaseClient, userId: string, workoutId: string): Promise<any> {
  const { data: workout, error } = await db.from("hevy_workouts")
    .select("id,title,description,routine_id,start_time_bangkok,end_time_bangkok,hevy_updated_at")
    .eq("user_id", userId).eq("id", workoutId).is("deleted_at", null).maybeSingle();
  if (error) throw new Error(error.message);
  if (!workout) return null;
  const [{ data: exercises, error: exerciseError }, { data: sets, error: setError }] = await Promise.all([
    db.from("hevy_workout_exercises").select("exercise_index,title,notes,exercise_template_id,superset_id")
      .eq("user_id", userId).eq("workout_id", workoutId).order("exercise_index"),
    db.from("hevy_workout_sets").select("exercise_index,set_index,set_type,weight_kg,reps,distance_meters,duration_seconds,rpe,custom_metric")
      .eq("user_id", userId).eq("workout_id", workoutId).order("exercise_index").order("set_index"),
  ]);
  if (exerciseError) throw new Error(exerciseError.message);
  if (setError) throw new Error(setError.message);
  return {
    timezone: "Asia/Bangkok", ...workout,
    exercises: (exercises || []).map((exercise: any) => ({
      ...exercise,
      sets: (sets || []).filter((set: any) => set.exercise_index === exercise.exercise_index),
    })),
  };
}

function nestedValue(value: unknown, keys: string[]): unknown {
  if (!value || typeof value !== "object") return undefined;
  const object = value as Record<string, unknown>;
  for (const key of keys) {
    if (object[key] !== undefined) return object[key];
  }
  for (const child of Object.values(object)) {
    if (Array.isArray(child)) continue;
    const found = nestedValue(child, keys);
    if (found !== undefined) return found;
  }
  return undefined;
}

function metricInterval(value: Record<string, unknown>): { start: number; end: number } | null {
  const startText = nestedValue(value, ["startTime"]);
  const endText = nestedValue(value, ["endTime"]);
  if (typeof startText !== "string" || typeof endText !== "string") return null;
  const start = new Date(startText).getTime();
  const end = new Date(endText).getTime();
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

function metricNumber(value: Record<string, unknown>, keys: string[]): number | null {
  const raw = nestedValue(value, keys);
  const parsed = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

async function workoutPhysiology(db: SupabaseClient, userId: string, workoutId: string): Promise<any> {
  const { data: workout, error: workoutError } = await db.from("hevy_workouts")
    .select("id,title,start_time,end_time,start_time_bangkok,end_time_bangkok")
    .eq("user_id", userId).eq("id", workoutId).is("deleted_at", null).maybeSingle();
  if (workoutError) throw new Error(workoutError.message);
  if (!workout) return null;

  const startMs = new Date(workout.start_time).getTime();
  const endMs = new Date(workout.end_time).getTime();
  const durationSeconds = Math.max(1, Math.round((endMs - startMs) / 1000));
  const { data: rows, error } = await db.from("health_metrics")
    .select("data_type,value,synced_at,source")
    .eq("user_id", userId)
    .in("data_type", ["exercise", "workout-heart-rate", "workout-active-energy-burned", "workout-source-reported-calories"])
    .gte("recorded_at", new Date(startMs - 30 * 60000).toISOString())
    .lte("recorded_at", new Date(endMs).toISOString())
    .order("recorded_at");
  if (error) throw new Error(error.message);

  const fullyContained = (rows || []).map((row: any) => ({ ...row, interval: metricInterval(row.value) }))
    .filter((row: any) => row.interval && row.interval.start >= startMs && row.interval.end <= endMs);
  const heartRate = fullyContained.filter((row: any) => row.data_type === "workout-heart-rate").map((row: any) => ({
    ...row,
    average: metricNumber(row.value, ["beatsPerMinuteAvg"]),
    minimum: metricNumber(row.value, ["beatsPerMinuteMin"]),
    maximum: metricNumber(row.value, ["beatsPerMinuteMax"]),
  })).filter((row: any) => row.average !== null);
  const coveredSeconds = heartRate.reduce((sum: number, row: any) =>
    sum + Math.round((row.interval.end - row.interval.start) / 1000), 0);
  const weightedAverage = heartRate.length && coveredSeconds > 0
    ? heartRate.reduce((sum: number, row: any) =>
      sum + row.average * ((row.interval.end - row.interval.start) / 1000), 0) / coveredSeconds
    : null;
  const third = Math.max(1, Math.floor(heartRate.length / 3));
  const firstThird = heartRate.slice(0, third);
  const lastThird = heartRate.slice(-third);
  const mean = (items: any[]) => items.length
    ? items.reduce((sum: number, item: any) => sum + item.average, 0) / items.length : null;
  const firstMean = mean(firstThird), lastMean = mean(lastThird);
  const minimumValues = heartRate.map((row: any) => row.minimum).filter((v: any) => v !== null);
  const maximumValues = heartRate.map((row: any) => row.maximum).filter((v: any) => v !== null);
  const calorieSum = (type: string) => {
    const matching = fullyContained.filter((row: any) => row.data_type === type)
      .map((row: any) => metricNumber(row.value, ["kcalSum", "kcal"]))
      .filter((value: number | null): value is number => value !== null);
    return { count: matching.length, total: matching.length ? matching.reduce((sum: number, value: number) => sum + value, 0) : null };
  };
  const active = calorieSum("workout-active-energy-burned");
  const sourceReported = calorieSum("workout-source-reported-calories");
  const exerciseSessions = (rows || []).filter((row: any) => row.data_type === "exercise")
    .map((row: any) => {
      const interval = metricInterval(row.value);
      if (!interval) return null;
      const overlapMs = Math.max(0, Math.min(endMs, interval.end) - Math.max(startMs, interval.start));
      const overlapPercent = overlapMs / (endMs - startMs) * 100;
      return {
        row,
        interval,
        overlapPercent,
        caloriesKcal: metricNumber(row.value, ["caloriesKcal"]),
        averageHeartRateBpm: metricNumber(row.value, ["averageHeartRateBeatsPerMinute"]),
        displayName: nestedValue(row.value, ["displayName"]),
        exerciseType: nestedValue(row.value, ["exerciseType"]),
        platform: nestedValue(row.value, ["platform"]),
        recordingMethod: nestedValue(row.value, ["recordingMethod"]),
      };
    })
    .filter((session: any) => session && session.overlapPercent >= 75)
    .sort((a: any, b: any) => {
      const aHasCalories = a.caloriesKcal !== null ? 1 : 0;
      const bHasCalories = b.caloriesKcal !== null ? 1 : 0;
      return bHasCalories - aHasCalories || b.overlapPercent - a.overlapPercent;
    });
  const exerciseSession = exerciseSessions[0] || null;
  const coverage = Math.min(100, coveredSeconds / durationSeconds * 100);
  const dataQuality = coverage >= 90 ? "complete" : coverage > 0 ? "partial" : "missing";
  const sourceSyncedAt = [...fullyContained, ...exerciseSessions.map((session: any) => session.row)]
    .reduce((latest: string | null, row: any) =>
    !latest || row.synced_at > latest ? row.synced_at : latest, null);
  const summary = {
    workout_id: workout.id, user_id: userId, workout_start: workout.start_time, workout_end: workout.end_time,
    heart_rate_sample_count: heartRate.length, heart_rate_covered_seconds: coveredSeconds,
    heart_rate_coverage_percent: Math.round(coverage * 100) / 100,
    average_heart_rate_bpm: weightedAverage == null ? null : Math.round(weightedAverage * 100) / 100,
    minimum_heart_rate_bpm: minimumValues.length ? Math.min(...minimumValues) : null,
    maximum_heart_rate_bpm: maximumValues.length ? Math.max(...maximumValues) : null,
    heart_rate_drift_bpm: firstMean == null || lastMean == null ? null : Math.round((lastMean - firstMean) * 100) / 100,
    active_calories_kcal: active.total == null ? null : Math.round(active.total * 100) / 100,
    total_calories_kcal: sourceReported.total == null ? null : Math.round(sourceReported.total * 100) / 100,
    active_calorie_sample_count: active.count, total_calorie_sample_count: sourceReported.count,
    data_quality: dataQuality, source_synced_at: sourceSyncedAt, computed_at: new Date().toISOString(),
  };
  const { error: cacheError } = await db.from("workout_health_summaries")
    .upsert(summary, { onConflict: "workout_id,user_id" });
  if (cacheError) throw new Error(cacheError.message);
  const {
    user_id: _userId,
    active_calories_kcal: overlappingActiveEnergyKcal,
    active_calorie_sample_count: overlappingActiveEnergySampleCount,
    total_calories_kcal: sourceReportedWorkoutCaloriesKcal,
    total_calorie_sample_count: sourceReportedCalorieRecordCount,
    ...publicSummary
  } = summary;
  return {
    timezone: "Asia/Bangkok", workout: { id: workout.id, title: workout.title,
      start_time_bangkok: workout.start_time_bangkok, end_time_bangkok: workout.end_time_bangkok },
    ...publicSummary,
    calorie_reporting: {
      source_reported_workout_calories_kcal: sourceReportedWorkoutCaloriesKcal,
      source_reported_record_count: sourceReportedCalorieRecordCount,
      attribution: sourceReportedWorkoutCaloriesKcal == null
        ? null
        : "google_health_total_calories_record_matched_to_hevy_workout_start",
      usage: "trend_context_only",
      use_for_calorie_deficit: false,
      display_by_default: sourceReportedWorkoutCaloriesKcal !== null,
    },
    exercise_session: exerciseSession ? {
      display_name: exerciseSession.displayName,
      exercise_type: exerciseSession.exerciseType,
      start_time: new Date(exerciseSession.interval.start).toISOString(),
      end_time: new Date(exerciseSession.interval.end).toISOString(),
      overlap_percent: Math.round(exerciseSession.overlapPercent * 100) / 100,
      session_calories_kcal: exerciseSession.caloriesKcal,
      average_heart_rate_bpm: exerciseSession.averageHeartRateBpm,
      platform: exerciseSession.platform,
      recording_method: exerciseSession.recordingMethod,
      source: exerciseSession.row.source,
      synced_at: exerciseSession.row.synced_at,
    } : null,
  };
}

async function routineDetail(db: SupabaseClient, userId: string, routineId: string): Promise<any> {
  const { data: routine, error } = await db.from("hevy_routines")
    .select("id,title,folder_id,hevy_updated_at").eq("user_id", userId).eq("id", routineId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!routine) return null;
  const [{ data: exercises, error: exerciseError }, { data: sets, error: setError }] = await Promise.all([
    db.from("hevy_routine_exercises").select("exercise_index,title,rest_seconds,notes,exercise_template_id,superset_id")
      .eq("user_id", userId).eq("routine_id", routineId).order("exercise_index"),
    db.from("hevy_routine_sets").select("exercise_index,set_index,set_type,weight_kg,reps,rep_range_start,rep_range_end,distance_meters,duration_seconds,rpe,custom_metric")
      .eq("user_id", userId).eq("routine_id", routineId).order("exercise_index").order("set_index"),
  ]);
  if (exerciseError) throw new Error(exerciseError.message);
  if (setError) throw new Error(setError.message);
  return {
    ...routine,
    exercises: (exercises || []).map((exercise: any) => ({
      ...exercise,
      sets: (sets || []).filter((set: any) => set.exercise_index === exercise.exercise_index)
        .map((set: any) => ({
          ...set,
          rep_range: set.rep_range_start == null && set.rep_range_end == null ? null : {
            start: set.rep_range_start, end: set.rep_range_end,
          },
        })),
    })),
  };
}

async function exerciseTemplates(db: SupabaseClient, userId: string, query: string, limit: number): Promise<any> {
  let request = db.from("hevy_exercise_templates")
    .select("id,title,exercise_type,primary_muscle_group,secondary_muscle_groups,equipment_category,is_custom")
    .eq("user_id", userId).order("title").limit(Math.min(Math.max(limit, 1), 50));
  if (query.trim()) request = request.ilike("title", `%${query.trim()}%`);
  const { data, error } = await request;
  if (error) throw new Error(error.message);
  return { query, exercise_templates: data || [] };
}

async function bodyMeasurements(db: SupabaseClient, userId: string, limit: number): Promise<any> {
  const { data, error } = await db.from("hevy_body_measurements")
    .select("measurement_date,weight_kg,lean_mass_kg,fat_percent")
    .eq("user_id", userId).order("measurement_date", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 365));
  if (error) throw new Error(error.message);
  return { unit: "metric", measurements: data || [] };
}

async function recentWorkouts(db: SupabaseClient, userId: string, limit: number): Promise<any> {
  const { data, error } = await db.from("hevy_workouts")
    .select("id,title,description,start_time_bangkok,end_time_bangkok,routine_id")
    .eq("user_id", userId).is("deleted_at", null)
    .order("start_time", { ascending: false }).limit(Math.min(Math.max(limit, 1), 20));
  if (error) throw new Error(error.message);
  const workouts = data || [];
  const ids = workouts.map((item: any) => item.id);
  if (!ids.length) return { timezone: "Asia/Bangkok", workouts: [] };
  const [{ data: exercises, error: exerciseError }, { data: sets, error: setError }] = await Promise.all([
    db.from("hevy_workout_exercises").select("workout_id,exercise_index").eq("user_id", userId).in("workout_id", ids),
    db.from("hevy_workout_sets").select("workout_id,set_type,weight_kg,reps,rpe").eq("user_id", userId).in("workout_id", ids),
  ]);
  if (exerciseError) throw new Error(exerciseError.message);
  if (setError) throw new Error(setError.message);
  return {
    timezone: "Asia/Bangkok",
    workouts: workouts.map((workout: any) => {
      const workoutSets = (sets || []).filter((set: any) => set.workout_id === workout.id && set.set_type !== "warmup");
      const rpes = workoutSets.map((set: any) => finiteNumber(set.rpe)).filter((value: number | null): value is number => value != null);
      return {
        ...workout,
        exercise_count: (exercises || []).filter((exercise: any) => exercise.workout_id === workout.id).length,
        completed_sets: workoutSets.length,
        volume_kg: Math.round(workoutSets.reduce((sum: number, set: any) =>
          sum + Number(set.weight_kg || 0) * Number(set.reps || 0), 0)),
        average_rpe: rpes.length ? round(rpes.reduce((sum: number, value: number) => sum + value, 0) / rpes.length) : null,
      };
    }),
  };
}

function displayMuscleGroup(primaryMuscle: unknown, exerciseTitle: unknown): string | null {
  const muscle = String(primaryMuscle || "").toLowerCase().replace(/[-\s]+/g, "_");
  if (["abdominals", "core", "neck", "cardio", "full_body"].includes(muscle)) return null;
  if (["chest", "pectorals"].includes(muscle)) return "Chest";
  if (["lats", "upper_back", "lower_back", "traps", "back"].includes(muscle)) return "Back";
  if (["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors", "legs"].includes(muscle)) return "Legs";
  if (["shoulders", "front_delts", "rear_delts", "side_delts", "delts"].includes(muscle)) return "Shoulders";
  if (["biceps", "triceps", "forearms", "arms"].includes(muscle)) return "Arms";

  const title = String(exerciseTitle || "").toLowerCase();
  if (/bench|chest|fly|pec|cable press/.test(title)) return "Chest";
  if (/row|pull|lat|deadlift|chin|back/.test(title)) return "Back";
  if (/squat|leg|lunge|calf|hamstring|quad|romanian/.test(title)) return "Legs";
  if (/shoulder|overhead|lateral|rear delt|face pull/.test(title)) return "Shoulders";
  if (/curl|tricep|pushdown|arm extension/.test(title)) return "Arms";
  return null;
}

async function trainingSummary(db: SupabaseClient, userId: string, days: number): Promise<any> {
  const safeDays = Math.min(Math.max(days, 1), 365);
  const since = new Date(Date.now() - safeDays * 86400000).toISOString();
  const { data: workouts, error } = await db.from("hevy_workouts")
    .select("id,title,start_time,end_time").eq("user_id", userId)
    .is("deleted_at", null).gte("start_time", since).order("start_time");
  if (error) throw new Error(error.message);
  const ids = (workouts || []).map((item: any) => item.id);
  let sets: any[] = [];
  let exercises: any[] = [];
  if (ids.length) {
    const [setResult, exerciseResult] = await Promise.all([
      db.from("hevy_workout_sets").select("workout_id,exercise_index,set_type,weight_kg,reps,rpe").eq("user_id", userId).in("workout_id", ids),
      db.from("hevy_workout_exercises").select("workout_id,exercise_index,title,exercise_template_id").eq("user_id", userId).in("workout_id", ids),
    ]);
    if (setResult.error) throw new Error(setResult.error.message);
    if (exerciseResult.error) throw new Error(exerciseResult.error.message);
    sets = setResult.data || [];
    exercises = exerciseResult.data || [];
  }
  const volumeKg = sets.reduce((sum, set) => sum + Number(set.weight_kg || 0) * Number(set.reps || 0), 0);
  const rpes = sets.map((set) => finiteNumber(set.rpe)).filter((value): value is number => value != null);
  const totalMinutes = (workouts || []).reduce((sum: number, workout: any) =>
    sum + Math.max(0, (new Date(workout.end_time).getTime() - new Date(workout.start_time).getTime()) / 60000), 0);
  const frequency = new Map<string, number>();
  for (const exercise of exercises) frequency.set(exercise.title, (frequency.get(exercise.title) || 0) + 1);
  const templateIds = [...new Set(exercises.map((exercise) => exercise.exercise_template_id).filter(Boolean))];
  let templates: any[] = [];
  if (templateIds.length) {
    const templateResult = await db.from("hevy_exercise_templates")
      .select("id,primary_muscle_group").eq("user_id", userId).in("id", templateIds);
    if (templateResult.error) throw new Error(templateResult.error.message);
    templates = templateResult.data || [];
  }
  const muscleByTemplate = new Map(templates.map((template) => [template.id, template.primary_muscle_group || "Other"]));
  const workoutById = new Map((workouts || []).map((workout: any) => [workout.id, workout]));
  const muscleGroups = new Map<string, any>();
  const exerciseCatalog = new Map<string, { title: string; muscle_group: string; workout_ids: Set<string> }>();
  for (const exercise of exercises) {
    const sourceMuscle = muscleByTemplate.get(exercise.exercise_template_id) || "Other";
    const muscle = displayMuscleGroup(sourceMuscle, exercise.title);
    if (!muscle) continue;
    const matched = sets.filter((set) => set.workout_id === exercise.workout_id &&
      set.exercise_index === exercise.exercise_index && set.set_type !== "warmup");
    const matchedRpes = matched.map((set) => finiteNumber(set.rpe)).filter((value): value is number => value != null);
    const hardSets = matched.filter((set) => finiteNumber(set.rpe) != null && Number(set.rpe) >= 7).length;
    const volume = matched.reduce((sum, set) => sum + Number(set.weight_kg || 0) * Number(set.reps || 0), 0);
    const bestE1rm = Math.max(0, ...matched.map((set) => {
      const weight = Number(set.weight_kg || 0), reps = Number(set.reps || 0);
      return weight > 0 && reps > 0 ? weight * (1 + reps / 30) : 0;
    }));
    const workout = workoutById.get(exercise.workout_id);
    const date = workout?.start_time || null;
    const aggregate = muscleGroups.get(muscle) || {
      name: muscle, hard_sets: 0, volume_kg: 0, workout_ids: new Set<string>(),
      last_trained: null, rpes: [], volume_by_workout: new Map<string, any>(),
      exercise_strength: new Map<string, any[]>(), source_muscles: new Set<string>(),
    };
    aggregate.hard_sets += hardSets;
    aggregate.volume_kg += volume;
    aggregate.workout_ids.add(exercise.workout_id);
    aggregate.rpes.push(...matchedRpes);
    aggregate.source_muscles.add(sourceMuscle);
    if (date && (!aggregate.last_trained || date > aggregate.last_trained)) aggregate.last_trained = date;
    const volumePoint = aggregate.volume_by_workout.get(exercise.workout_id) || { workout_id: exercise.workout_id, date, volume_kg: 0 };
    volumePoint.volume_kg += volume;
    aggregate.volume_by_workout.set(exercise.workout_id, volumePoint);
    if (bestE1rm > 0 && date) {
      const strengthPoints = aggregate.exercise_strength.get(exercise.title) || [];
      strengthPoints.push({ date, value: bestE1rm });
      aggregate.exercise_strength.set(exercise.title, strengthPoints);
    }
    muscleGroups.set(muscle, aggregate);

    const catalogKey = `${muscle}\u0000${exercise.title}`;
    const catalogItem = exerciseCatalog.get(catalogKey) || { title: exercise.title, muscle_group: muscle, workout_ids: new Set<string>() };
    catalogItem.workout_ids.add(exercise.workout_id);
    exerciseCatalog.set(catalogKey, catalogItem);
  }
  const summarizedMuscles = [...muscleGroups.values()].map((aggregate) => {
    const strengthChanges = [...aggregate.exercise_strength.values()].map((points: any[]) => {
      const ordered = points.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const first = ordered[0]?.value, last = ordered.at(-1)?.value;
      return first > 0 && last > 0 && ordered.length > 1 ? ((last - first) / first) * 100 : null;
    }).filter((value): value is number => value != null && Number.isFinite(value));
    const volumeHistory = [...aggregate.volume_by_workout.values()]
      .sort((a: any, b: any) => String(a.date).localeCompare(String(b.date)))
      .map((point: any) => ({ ...point, volume_kg: Math.round(point.volume_kg) }));
    return {
      name: aggregate.name,
      hard_sets: aggregate.hard_sets,
      volume_kg: Math.round(aggregate.volume_kg),
      workout_sessions: aggregate.workout_ids.size,
      last_trained: aggregate.last_trained,
      average_rpe: aggregate.rpes.length ? round(aggregate.rpes.reduce((sum: number, value: number) => sum + value, 0) / aggregate.rpes.length) : null,
      strength_change_percent: strengthChanges.length ? round(strengthChanges.reduce((sum, value) => sum + value, 0) / strengthChanges.length) : null,
      volume_history: volumeHistory,
      source_muscles: [...aggregate.source_muscles].sort(),
    };
  }).sort((a, b) => b.hard_sets - a.hard_sets);
  const summarizedExercises = [...exerciseCatalog.values()]
    .map((item) => ({ title: item.title, muscle_group: item.muscle_group, workout_appearances: item.workout_ids.size }))
    .sort((a, b) => a.muscle_group.localeCompare(b.muscle_group) || b.workout_appearances - a.workout_appearances || a.title.localeCompare(b.title));
  return {
    timezone: "Asia/Bangkok", period_days: safeDays, workouts: workouts?.length || 0,
    completed_sets: sets.length, total_volume_kg: Math.round(volumeKg),
    average_rpe: rpes.length ? round(rpes.reduce((sum, value) => sum + value, 0) / rpes.length) : null,
    rpe_coverage_percent: sets.length ? Math.round((rpes.length / sets.length) * 100) : 0,
    total_training_minutes: Math.round(totalMinutes),
    most_frequent_exercises: [...frequency.entries()].sort((a,b) => b[1]-a[1]).slice(0,10)
      .map(([title,count]) => ({ title, workout_appearances: count })),
    muscle_groups: summarizedMuscles,
    exercise_catalog: summarizedExercises,
  };
}

async function exerciseProgress(db: SupabaseClient, userId: string, query: string, days: number): Promise<any> {
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 730) * 86400000).toISOString();
  const { data: exercises, error } = await db.from("hevy_workout_exercises")
    .select("workout_id,exercise_index,title,exercise_template_id")
    .eq("user_id", userId).eq("title", query).limit(500);
  if (error) throw new Error(error.message);
  if (!exercises?.length) return { query, sessions: [] };
  const workoutIds = [...new Set(exercises.map((item: any) => item.workout_id))];
  const { data: workouts } = await db.from("hevy_workouts")
    .select("id,start_time_bangkok,start_time").eq("user_id", userId)
    .is("deleted_at", null).gte("start_time", since).in("id", workoutIds);
  const valid = new Map((workouts || []).map((item: any) => [item.id, item]));
  const { data: sets } = await db.from("hevy_workout_sets")
    .select("workout_id,exercise_index,weight_kg,reps,rpe").eq("user_id", userId).in("workout_id", [...valid.keys()]);
  const sessions = buildExerciseProgressSessions(exercises, valid, sets || []);
  return { timezone: "Asia/Bangkok", query, sessions };
}

function buildExerciseProgressSessions(exercises: any[], valid: Map<string, any>, sets: any[]): any[] {
  return exercises.filter((exercise: any) => valid.has(exercise.workout_id)).map((exercise: any) => {
    const matched = (sets || []).filter((set: any) =>
      set.workout_id === exercise.workout_id && set.exercise_index === exercise.exercise_index);
    const validRpes = matched.map((set: any) => finiteNumber(set.rpe)).filter((value: number | null): value is number => value != null);
    const bestSet = matched.reduce((best: any, set: any) => {
      const weight = Number(set.weight_kg || 0), reps = Number(set.reps || 0);
      const estimate = weight > 0 && reps > 0 ? weight * (1 + reps / 30) : 0;
      return estimate > best.estimate ? { estimate, weight_kg: weight, reps, rpe: finiteNumber(set.rpe) } : best;
    }, { estimate: 0, weight_kg: null, reps: null, rpe: null });
    return {
      workout_id: exercise.workout_id,
      date_bangkok: valid.get(exercise.workout_id)?.start_time_bangkok,
      start_time_bangkok: valid.get(exercise.workout_id)?.start_time_bangkok,
      title: exercise.title,
      sets: matched.length,
      max_weight_kg: Math.max(0, ...matched.map((set: any) => Number(set.weight_kg || 0))),
      volume_kg: Math.round(matched.reduce((sum: number, set: any) =>
        sum + Number(set.weight_kg || 0) * Number(set.reps || 0), 0)),
      average_rpe: validRpes.length ? round(validRpes.reduce((sum: number, value: number) => sum + value, 0) / validRpes.length) : null,
      best_set: bestSet.estimate > 0 ? { weight_kg: bestSet.weight_kg, reps: bestSet.reps, rpe: bestSet.rpe } : null,
      best_estimated_1rm_kg: Math.round(Math.max(0, ...matched.map((set: any) => {
        const weight = Number(set.weight_kg || 0), reps = Number(set.reps || 0);
        return weight > 0 && reps > 0 ? weight * (1 + reps / 30) : 0;
      })) * 10) / 10,
    };
  }).sort((a: any,b: any) => String(a.date_bangkok).localeCompare(String(b.date_bangkok)));
}

async function exerciseProgressBatch(db: SupabaseClient, userId: string, catalog: any[], days: number): Promise<any[]> {
  const titles = [...new Set(catalog.map((item: any) => item.title).filter(Boolean))];
  if (!titles.length) return [];
  const since = new Date(Date.now() - Math.min(Math.max(days, 1), 730) * 86400000).toISOString();
  const { data: exercises, error } = await db.from("hevy_workout_exercises")
    .select("workout_id,exercise_index,title,exercise_template_id")
    .eq("user_id", userId).in("title", titles).limit(5000);
  if (error) throw new Error(error.message);
  if (!exercises?.length) return catalog.map((item: any) => ({
    timezone: "Asia/Bangkok", query: item.title, muscle_group: item.muscle_group, sessions: [],
  }));
  const workoutIds = [...new Set(exercises.map((item: any) => item.workout_id))];
  const [{ data: workouts, error: workoutError }, { data: sets, error: setError }] = await Promise.all([
    db.from("hevy_workouts").select("id,start_time_bangkok,start_time").eq("user_id", userId)
      .is("deleted_at", null).gte("start_time", since).in("id", workoutIds),
    db.from("hevy_workout_sets").select("workout_id,exercise_index,weight_kg,reps,rpe")
      .eq("user_id", userId).in("workout_id", workoutIds),
  ]);
  if (workoutError) throw new Error(workoutError.message);
  if (setError) throw new Error(setError.message);
  const valid = new Map((workouts || []).map((item: any) => [item.id, item]));
  const byTitle = new Map<string, any[]>();
  for (const exercise of exercises) {
    const items = byTitle.get(exercise.title) || [];
    items.push(exercise);
    byTitle.set(exercise.title, items);
  }
  return catalog.map((item: any) => ({
    timezone: "Asia/Bangkok",
    query: item.title,
    muscle_group: item.muscle_group,
    sessions: buildExerciseProgressSessions(byTitle.get(item.title) || [], valid, sets || []),
  }));
}

async function recoveryComparison(db: SupabaseClient, userId: string, days: number): Promise<any> {
  const safeDays = Math.min(Math.max(days, 1), 365);
  const since = new Date(Date.now() - safeDays * 86400000);
  const sinceDate = since.toISOString().slice(0,10);
  const sinceTime = new Date(Date.now() - safeDays * 86400000).toISOString();
  const untilDate = new Date().toISOString().slice(0, 10);
  const [activityResult, workoutResult, recoveryResult] = await Promise.all([
    db.rpc("get_health_activity_daily_since", {
      p_user_id: userId, p_since_date: sinceDate, p_until_date: untilDate,
    }),
    db.from("hevy_workouts").select("id,start_time_bangkok,start_time,end_time")
      .eq("user_id", userId).is("deleted_at", null).gte("start_time", sinceTime),
    db.from("health_metrics").select("data_type,recorded_at_bangkok,value")
      .eq("user_id", userId).in("data_type", ["sleep","daily-heart-rate-variability","daily-resting-heart-rate"])
      .gte("recorded_at", sinceTime).order("recorded_at"),
  ]);
  for (const result of [activityResult, workoutResult, recoveryResult]) {
    if (result.error) throw new Error(result.error.message);
  }
  const dailyActivity = (activityResult.data || [])
    .sort((a: any, b: any) => String(a.activity_date).localeCompare(String(b.activity_date)));
  return {
    timezone: "Asia/Bangkok", period_days: safeDays,
    workouts: workoutResult.data || [],
    daily_activity: dailyActivity,
    recovery_metrics: recoveryResult.data || [],
    note: "Values are source measurements; ChatGPT should identify associations, not diagnose medical conditions.",
  };
}

function finiteNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value: number | null, digits = 1): number | null {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stats(values: Array<number | null>): { count: number; average: number | null; min: number | null; max: number | null; latest: number | null } {
  const valid = values.filter((value): value is number => value != null && Number.isFinite(value));
  return {
    count: valid.length,
    average: valid.length ? round(valid.reduce((sum, value) => sum + value, 0) / valid.length) : null,
    min: valid.length ? round(Math.min(...valid)) : null,
    max: valid.length ? round(Math.max(...valid)) : null,
    latest: valid.length ? round(valid[valid.length - 1]) : null,
  };
}

function nested(value: unknown, path: string[]): unknown {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function sleepSummary(value: unknown): Record<string, number | null> {
  const stages = nested(value, ["sleep", "summary", "stagesSummary"]);
  const stageMinutes = new Map<string, number>();
  if (Array.isArray(stages)) {
    for (const stage of stages) {
      if (!stage || typeof stage !== "object") continue;
      const item = stage as Record<string, unknown>;
      const minutes = finiteNumber(item.minutes);
      if (typeof item.type === "string" && minutes != null) stageMinutes.set(item.type, minutes);
    }
  }
  return {
    asleep_minutes: finiteNumber(nested(value, ["sleep", "summary", "minutesAsleep"])),
    awake_minutes: finiteNumber(nested(value, ["sleep", "summary", "minutesAwake"])),
    light_minutes: stageMinutes.get("LIGHT") ?? null,
    deep_minutes: stageMinutes.get("DEEP") ?? null,
    rem_minutes: stageMinutes.get("REM") ?? null,
  };
}

function compactEnvelope(periodDays: number, summary: unknown, freshness: unknown, coverage: unknown, evidence: unknown = undefined): Record<string, unknown> {
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    timezone: "Asia/Bangkok",
    period: { days: periodDays },
    freshness,
    coverage,
    summary,
    ...(evidence === undefined ? {} : { evidence }),
    data_quality: {
      status: "source_measurements",
      note: "Use trends as decision support only; do not diagnose medical conditions.",
    },
  };
}

async function dataFreshness(db: SupabaseClient, userId: string): Promise<any> {
  const metricTypes = ["steps", "sleep", "daily-heart-rate-variability", "daily-resting-heart-rate", "active-zone-minutes", "weight"];
  const metricQueries = metricTypes.map((dataType) => db.from("health_metrics")
    .select("recorded_at,synced_at").eq("user_id", userId).eq("data_type", dataType)
    .order("recorded_at", { ascending: false }).limit(1).maybeSingle());
  const [workoutResult, ...metricResults] = await Promise.all([
    db.from("hevy_workouts").select("start_time,synced_at").eq("user_id", userId)
      .is("deleted_at", null).order("start_time", { ascending: false }).limit(1).maybeSingle(),
    ...metricQueries,
  ]);
  if (workoutResult.error) throw new Error(workoutResult.error.message);
  const metrics: Record<string, unknown> = {};
  metricResults.forEach((result, index) => {
    if (result.error) throw new Error(result.error.message);
    metrics[metricTypes[index]] = result.data || null;
  });
  return { hevy: workoutResult.data || null, google_health: metrics };
}

async function healthRecap(db: SupabaseClient, userId: string, days: number): Promise<any> {
  const safeDays = Math.min(Math.max(days, 1), 365);
  const [raw, training, freshness] = await Promise.all([
    recoveryComparison(db, userId, safeDays),
    trainingSummary(db, userId, safeDays),
    dataFreshness(db, userId),
  ]);
  const sleeps = raw.recovery_metrics.filter((row: any) => row.data_type === "sleep").map((row: any) => sleepSummary(row.value));
  const hrv = raw.recovery_metrics.filter((row: any) => row.data_type === "daily-heart-rate-variability")
    .map((row: any) => finiteNumber(nested(row.value, ["dailyHeartRateVariability", "averageHeartRateVariabilityMilliseconds"])));
  const restingHr = raw.recovery_metrics.filter((row: any) => row.data_type === "daily-resting-heart-rate")
    .map((row: any) => finiteNumber(nested(row.value, ["dailyRestingHeartRate", "beatsPerMinute"])));
  const completeActivity = raw.daily_activity.filter((row: any) => row.is_complete_day);
  const partialActivity = raw.daily_activity.filter((row: any) => !row.is_complete_day).slice(-1)[0] || null;
  const sleepMetrics = {
    asleep_minutes: stats(sleeps.map((item: any) => item.asleep_minutes)),
    awake_minutes: stats(sleeps.map((item: any) => item.awake_minutes)),
    light_minutes: stats(sleeps.map((item: any) => item.light_minutes)),
    deep_minutes: stats(sleeps.map((item: any) => item.deep_minutes)),
    rem_minutes: stats(sleeps.map((item: any) => item.rem_minutes)),
  };
  return compactEnvelope(safeDays, {
    recovery: { hrv_ms: stats(hrv), resting_heart_rate_bpm: stats(restingHr) },
    sleep: sleepMetrics,
    activity: {
      steps: stats(completeActivity.map((row: any) => finiteNumber(row.steps))),
      active_zone_minutes: stats(completeActivity.map((row: any) => finiteNumber(row.active_zone_minutes))),
      partial_day: partialActivity,
    },
    training,
  }, freshness, {
    requested_days: safeDays,
    activity_complete_days: completeActivity.length,
    sleep_nights: sleeps.length,
    hrv_days: hrv.filter((value: number | null) => value != null).length,
    resting_heart_rate_days: restingHr.filter((value: number | null) => value != null).length,
    workout_sessions: raw.workouts.length,
  }, {
    activity_daily: completeActivity.map((row: any) => ({
      date: row.activity_date,
      steps: finiteNumber(row.steps),
      active_zone_minutes: finiteNumber(row.active_zone_minutes),
    })),
    recovery_daily: raw.recovery_metrics.map((row: any) => ({
      date: row.recorded_at_bangkok,
      type: row.data_type,
      value: row.data_type === "daily-heart-rate-variability"
        ? finiteNumber(nested(row.value, ["dailyHeartRateVariability", "averageHeartRateVariabilityMilliseconds"]))
        : row.data_type === "daily-resting-heart-rate"
          ? finiteNumber(nested(row.value, ["dailyRestingHeartRate", "beatsPerMinute"]))
          : sleepSummary(row.value).asleep_minutes,
    })),
  });
}

async function portalDashboard(db: SupabaseClient, userId: string, days: number): Promise<any> {
  const safeDays = Math.min(Math.max(days, 1), 365);
  const recap = await healthRecap(db, userId, safeDays);
  const training = (recap.summary as any)?.training || {};
  const catalog = training.exercise_catalog || [];
  const exerciseEntries = [...catalog]
    .sort((a: any, b: any) => b.workout_appearances - a.workout_appearances || a.title.localeCompare(b.title));
  const [recent, measurements, progress] = await Promise.all([
    recentWorkouts(db, userId, 5),
    bodyMeasurements(db, userId, Math.min(safeDays, 365)),
    exerciseProgressBatch(db, userId, exerciseEntries, safeDays),
  ]);
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    timezone: "Asia/Bangkok",
    period: { days: safeDays },
    recap,
    exercise_progress: progress,
    recent_workouts: recent.workouts,
    body_measurements: measurements.measurements,
  };
}

async function dailyState(db: SupabaseClient, userId: string, date?: string | null): Promise<any> {
  const targetDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? date
    : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const since = `${targetDate}T00:00:00+07:00`;
  const until = `${targetDate}T23:59:59+07:00`;
  const [activityResult, recoveryResult, workoutResult, freshness] = await Promise.all([
    db.rpc("get_health_activity_daily_since", { p_user_id: userId, p_since_date: targetDate, p_until_date: targetDate }),
    db.from("health_metrics").select("data_type,value,recorded_at_bangkok").eq("user_id", userId)
      .in("data_type", ["sleep", "daily-heart-rate-variability", "daily-resting-heart-rate"])
      .gte("recorded_at", since).lte("recorded_at", until).order("recorded_at"),
    db.from("hevy_workouts").select("id,title,start_time_bangkok,end_time_bangkok").eq("user_id", userId)
      .is("deleted_at", null).gte("start_time", since).lte("start_time", until).order("start_time"),
    dataFreshness(db, userId),
  ]);
  for (const result of [activityResult, recoveryResult, workoutResult]) if (result.error) throw new Error(result.error.message);
  const recoveryRows = recoveryResult.data || [];
  const sleep = recoveryRows.find((row: any) => row.data_type === "sleep");
  const hrv = recoveryRows.find((row: any) => row.data_type === "daily-heart-rate-variability");
  const resting = recoveryRows.find((row: any) => row.data_type === "daily-resting-heart-rate");
  return compactEnvelope(1, {
    date: targetDate,
    activity: activityResult.data?.[0] || null,
    sleep: sleep ? sleepSummary(sleep.value) : null,
    hrv_ms: hrv ? finiteNumber(nested(hrv.value, ["dailyHeartRateVariability", "averageHeartRateVariabilityMilliseconds"])) : null,
    resting_heart_rate_bpm: resting ? finiteNumber(nested(resting.value, ["dailyRestingHeartRate", "beatsPerMinute"])) : null,
    workouts: workoutResult.data || [],
  }, freshness, { requested_days: 1 });
}

async function syncMissingData(db: SupabaseClient, userId: string, req: Request): Promise<any> {
  const body = await req.json().catch(() => ({}));
  const requested = Array.isArray(body.sources) ? body.sources : ["hevy", "google_health"];
  const sources = [...new Set(requested.filter((source: unknown) => source === "hevy" || source === "google_health"))] as string[];
  if (!sources.length) throw new Error("sources must contain hevy or google_health");
  const results: Record<string, unknown> = {};
  for (const source of sources) {
    const { data: lockRows, error: lockError } = await db.rpc("try_acquire_ai_health_sync", {
      p_user_id: userId, p_source: source, p_cooldown_seconds: 900, p_stale_after_seconds: 300,
    });
    if (lockError) throw new Error(lockError.message);
    const lock = lockRows?.[0];
    if (!lock?.acquired) {
      results[source] = { status: lock?.status || "cooldown_active", retry_after_seconds: lock?.retry_after_seconds || 1 };
      continue;
    }
    const functionName = source === "hevy" ? "sync-hevy-data" : "sync-health-data";
    try {
      const response = await fetch(`${required("SUPABASE_URL")}/functions/v1/${functionName}`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${required("SYNC_SHARED_SECRET")}`, "Content-Type": "application/json" },
        body: JSON.stringify(source === "hevy" ? { full: false, source: "codex_plugin" } : { source: "codex_plugin" }),
      });
      const payload = await response.json().catch(() => ({}));
      const status = response.ok ? "success" : "error";
      await db.from("ai_health_sync_guards").update({
        status, last_completed_at: new Date().toISOString(), last_error: response.ok ? null : JSON.stringify(payload), updated_at: new Date().toISOString(),
      }).eq("user_id", userId).eq("source", source);
      results[source] = response.ok ? { status: "synced", result: payload } : { status: "partial_failure", error: payload };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.from("ai_health_sync_guards").update({ status: "error", last_completed_at: new Date().toISOString(), last_error: message, updated_at: new Date().toISOString() })
        .eq("user_id", userId).eq("source", source);
      results[source] = { status: "partial_failure", error: message };
    }
  }
  return { schema_version: "1.0", generated_at: new Date().toISOString(), cooldown_seconds: 900, results };
}

async function writeWorkout(db: SupabaseClient, userId: string, req: Request, workoutId?: string): Promise<any> {
  const body = await req.json();
  const key = req.headers.get("Idempotency-Key") || body.idempotency_key;
  if (!key) throw new Error("Idempotency-Key is required");
  const payload = body.workout ? { workout: body.workout } : body;
  delete payload.idempotency_key;
  const requestHash = await hash({ workoutId, payload });
  const { data: existing } = await db.from("hevy_action_requests")
    .select("request_hash,status,response_payload,error_message").eq("idempotency_key", key).maybeSingle();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new Error("Idempotency key was already used for a different request");
    if (existing.status === "success") return existing.response_payload;
    if (existing.status === "processing") throw new Error("This workout request is already processing");
  }
  await db.from("hevy_action_requests").upsert({
    idempotency_key: key, user_id: userId, action: workoutId ? "update_workout" : "create_workout",
    request_hash: requestHash, status: "processing", error_message: null,
  }, { onConflict: "idempotency_key" });
  try {
    const workout = await hevy(workoutId ? `/workouts/${encodeURIComponent(workoutId)}` : "/workouts", {
      method: workoutId ? "PUT" : "POST", body: JSON.stringify(payload),
    });
    await cacheWorkout(db, userId, workout);
    const compact = { status: "success", workout_id: workout.id, title: workout.title,
      start_time: workout.start_time, end_time: workout.end_time };
    await db.from("hevy_action_requests").update({ status: "success", response_payload: compact })
      .eq("idempotency_key", key);
    return compact;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("hevy_action_requests").update({ status: "error", error_message: message })
      .eq("idempotency_key", key);
    throw error;
  }
}

async function writeRoutine(db: SupabaseClient, userId: string, req: Request, routineId?: string): Promise<any> {
  const body = await req.json();
  const key = req.headers.get("Idempotency-Key") || body.idempotency_key;
  if (!key) throw new Error("Idempotency-Key is required");
  const payload = body.routine ? { routine: body.routine } : body;
  delete payload.idempotency_key;
  const requestHash = await hash({ resource: "routine", routineId, payload });
  const { data: existing } = await db.from("hevy_action_requests")
    .select("request_hash,status,response_payload").eq("idempotency_key", key).maybeSingle();
  if (existing) {
    if (existing.request_hash !== requestHash) throw new Error("Idempotency key was already used for a different request");
    if (existing.status === "success") return existing.response_payload;
    if (existing.status === "processing") throw new Error("This routine request is already processing");
  }
  await db.from("hevy_action_requests").upsert({
    idempotency_key: key, user_id: userId, action: routineId ? "update_routine" : "create_routine",
    request_hash: requestHash, status: "processing", error_message: null,
  }, { onConflict: "idempotency_key" });
  try {
    const routine = await hevy(routineId ? `/routines/${encodeURIComponent(routineId)}` : "/routines", {
      method: routineId ? "PUT" : "POST", body: JSON.stringify(payload),
    });
    const resolved = routine.routine || routine;
    await cacheRoutine(db, userId, resolved);
    const compact = { status: "success", routine_id: resolved.id, title: resolved.title };
    await db.from("hevy_action_requests").update({ status: "success", response_payload: compact })
      .eq("idempotency_key", key);
    return compact;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.from("hevy_action_requests").update({ status: "error", error_message: message })
      .eq("idempotency_key", key);
    throw error;
  }
}

Deno.serve(async (req) => {
  const db = admin();
  const userId = required("HEALTH_USER_ID");
  try {
    const caller = authorize(req);
    const path = pathAfterFunction(req.url);
    const route = path[0] || "";
    const params = new URL(req.url).searchParams;
    if (req.method === "GET" && route === "v1" && path[1] === "daily-state")
      return json(await dailyState(db, userId, params.get("date")));
    if (req.method === "GET" && route === "v1" && path[1] === "health-recap")
      return json(await healthRecap(db, userId, Number(params.get("days") || 28)));
    if (req.method === "GET" && route === "v1" && path[1] === "workout-progress") {
      const query = params.get("exercise");
      return json(query
        ? await exerciseProgress(db, userId, query, Number(params.get("days") || 28))
        : await trainingSummary(db, userId, Number(params.get("days") || 28)));
    }
    if (req.method === "GET" && route === "v1" && path[1] === "data-freshness")
      return json(compactEnvelope(1, {}, await dataFreshness(db, userId), { requested_days: 1 }));
    if (req.method === "GET" && route === "v1" && path[1] === "portal-dashboard")
      return json(await portalDashboard(db, userId, Number(params.get("days") || 30)));
    if (req.method === "POST" && route === "v1" && path[1] === "sync-missing-data") {
      if (caller !== "codex_plugin") return json({ error: "This endpoint is restricted to the Codex plugin" }, 403);
      return json(await syncMissingData(db, userId, req));
    }
    if (req.method === "GET" && route === "recent-workouts")
      return json(await recentWorkouts(db, userId, Number(params.get("limit") || 5)));
    if (req.method === "GET" && route === "training-summary")
      return json(await trainingSummary(db, userId, Number(params.get("days") || 28)));
    if (req.method === "GET" && route === "exercise-progress")
      return json(await exerciseProgress(db, userId, params.get("query") || "", Number(params.get("days") || 180)));
    if (req.method === "GET" && route === "recovery-comparison")
      return json(await recoveryComparison(db, userId, Number(params.get("days") || 28)));
    if (req.method === "GET" && route === "workouts" && path[1] && path[2] === "physiology") {
      const physiology = await workoutPhysiology(db, userId, path[1]);
      return physiology ? json(physiology) : json({ error: "Workout not found" }, 404);
    }
    if (req.method === "GET" && route === "workouts" && path[1]) {
      const detail = await workoutDetail(db, userId, path[1]);
      return detail ? json(detail) : json({ error: "Workout not found" }, 404);
    }
    if (req.method === "GET" && route === "exercise-templates" && path[1]) {
      const { data, error } = await db.from("hevy_exercise_templates")
        .select("id,title,exercise_type,primary_muscle_group,secondary_muscle_groups,equipment_category,is_custom")
        .eq("user_id", userId).eq("id", path[1]).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? json(data) : json({ error: "Exercise template not found" }, 404);
    }
    if (req.method === "GET" && route === "exercise-templates")
      return json(await exerciseTemplates(db, userId, params.get("query") || "", Number(params.get("limit") || 20)));
    if (req.method === "GET" && route === "exercise-history" && path[1])
      return json(await hevy(`/exercise_history/${encodeURIComponent(path[1])}`));
    if (req.method === "GET" && route === "body-measurements")
      return json(await bodyMeasurements(db, userId, Number(params.get("limit") || 90)));
    if (req.method === "GET" && route === "routines" && path[1]) {
      const detail = await routineDetail(db, userId, path[1]);
      return detail ? json(detail) : json({ error: "Routine not found" }, 404);
    }
    if (req.method === "GET" && route === "routines") {
      const { data, error } = await db.from("hevy_routines")
        .select("id,title,folder_id,hevy_updated_at").eq("user_id", userId).order("title");
      if (error) throw new Error(error.message);
      return json({ routines: data || [] });
    }
    if (req.method === "POST" && route === "workouts")
      return json(await writeWorkout(db, userId, req), 201);
    if (req.method === "PUT" && route === "workouts" && path[1])
      return json(await writeWorkout(db, userId, req, path[1]));
    if (req.method === "POST" && route === "routines")
      return json(await writeRoutine(db, userId, req), 201);
    if (req.method === "PUT" && route === "routines" && path[1])
      return json(await writeRoutine(db, userId, req, path[1]));
    if (req.method === "POST" && route === "sync") {
      const result = await fetch(`${required("SUPABASE_URL")}/functions/v1/sync-hevy-data`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${required("SYNC_SHARED_SECRET")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ full: false, source: "gpt_action" }),
      });
      return json(await result.json(), result.status);
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof Response) return error;
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return json({ error: message }, 500);
  }
});
