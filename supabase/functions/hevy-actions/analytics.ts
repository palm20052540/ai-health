/** Pure training analytics. No clients, credentials, environment reads or network access. */
// Source rows span several existing tables; analytics validates numeric fields at use sites.
// deno-lint-ignore no-explicit-any
export type SourceRow = Record<string, any>;

type CatalogItem = {
  exercise_template_id: string | null;
  identity_source: string;
  title: string;
  muscle_group: string;
  muscle_attribution: "primary_only";
  source_muscle: string | null;
  workout_ids: Set<string>;
};

export function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function round(value: number | null, digits = 1): number | null {
  if (value == null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Only logged RPE on the 1–10 scale is evidence; missing/invalid values never mean zero. */
export function validRpe(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 1 && parsed <= 10 ? parsed : null;
}

export function isWorkingSet(set: SourceRow): boolean {
  return String(set.set_type ?? set.type ?? "").trim().toLowerCase().replace(/[-_\s]/g, "") !== "warmup";
}

export function exerciseTemplateId(exercise: SourceRow): string | null {
  const value = exercise.exercise_template_id;
  return value == null || String(value).trim() === "" ? null : String(value);
}

/** Legacy title identity is exposed explicitly and never merged with a known template ID. */
export function exerciseIdentity(exercise: SourceRow): string {
  const id = exerciseTemplateId(exercise);
  return id == null ? `legacy:${String(exercise.title || "Exercise")}` : `template:${id}`;
}

function nonNegativeNumber(value: unknown): number | null {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 0 ? parsed : null;
}

export function summarizeWorkingSets(sets: SourceRow[]) {
  const working = sets.filter(isWorkingSet);
  const rpes = working.map((set) => validRpe(set.rpe)).filter((value): value is number => value != null);
  const weights = working.map((set) => nonNegativeNumber(set.weight_kg)).filter((value): value is number => value != null);
  let volume = 0;
  let volumeSetCount = 0;
  let bestSet: { weight_kg: number; reps: number; rpe: number | null; set_index: number | null; estimated_1rm_kg: number } | null = null;
  for (const set of working) {
    const weight = nonNegativeNumber(set.weight_kg), reps = nonNegativeNumber(set.reps);
    if (weight == null || reps == null) continue;
    volume += weight * reps;
    volumeSetCount += 1;
    if (weight <= 0 || reps <= 0) continue;
    const estimate = weight * (1 + reps / 30);
    if (!bestSet || estimate > bestSet.estimated_1rm_kg) {
      bestSet = { weight_kg: weight, reps, rpe: validRpe(set.rpe), set_index: finiteNumber(set.set_index), estimated_1rm_kg: estimate };
    }
  }
  return {
    working_sets: working.length,
    rpe_count: rpes.length,
    rpe_coverage_percent: working.length ? Math.round(rpes.length / working.length * 100) : 0,
    average_rpe: rpes.length ? round(rpes.reduce((sum, value) => sum + value, 0) / rpes.length) : null,
    hard_sets: rpes.filter((value) => value >= 7).length,
    volume_kg: Math.round(volume),
    volume_set_count: volumeSetCount,
    max_weight_kg: weights.length ? Math.max(...weights) : null,
    best_set: bestSet ? { ...bestSet, estimated_1rm_kg: round(bestSet.estimated_1rm_kg)! } : null,
    best_estimated_1rm_kg: bestSet ? round(bestSet.estimated_1rm_kg) : null,
  };
}

/** Template primary muscle only. No title inference and no secondary-muscle double counting. */
export function displayMuscleGroup(primaryMuscle: unknown): string {
  const muscle = String(primaryMuscle || "").toLowerCase().replace(/[-\s]+/g, "_");
  if (["chest", "pectorals"].includes(muscle)) return "Chest";
  if (["lats", "upper_back", "lower_back", "traps", "back"].includes(muscle)) return "Back";
  if (["quadriceps", "hamstrings", "glutes", "calves", "adductors", "abductors", "legs"].includes(muscle)) return "Legs";
  if (["shoulders", "front_delts", "rear_delts", "side_delts", "delts"].includes(muscle)) return "Shoulders";
  if (["biceps", "triceps", "forearms", "arms"].includes(muscle)) return "Arms";
  if (["abdominals", "core"].includes(muscle)) return "Core";
  return "Other";
}

function exerciseSetsKey(row: SourceRow): string {
  return JSON.stringify([String(row.workout_id), String(row.exercise_index)]);
}

function indexSets(sets: SourceRow[]): Map<string, SourceRow[]> {
  const byExercise = new Map<string, SourceRow[]>();
  for (const set of sets) {
    const key = exerciseSetsKey(set);
    const items = byExercise.get(key) || [];
    items.push(set);
    byExercise.set(key, items);
  }
  return byExercise;
}

export function buildExerciseProgressSessions(exercises: SourceRow[], workouts: Map<string, SourceRow>, sets: SourceRow[]) {
  const byExercise = indexSets(sets);
  return exercises.filter((exercise) => workouts.has(exercise.workout_id)).map((exercise) => {
    const matched = (byExercise.get(exerciseSetsKey(exercise)) || []).filter(isWorkingSet);
    const workout = workouts.get(exercise.workout_id)!;
    const metrics = summarizeWorkingSets(matched);
    return {
      workout_id: exercise.workout_id,
      exercise_template_id: exerciseTemplateId(exercise),
      exercise_index: exercise.exercise_index,
      identity_source: exerciseTemplateId(exercise) == null ? "legacy_title" : "exercise_template_id",
      date: workout.start_time ?? null,
      start_time: workout.start_time ?? null,
      date_bangkok: workout.start_time_bangkok ?? null,
      start_time_bangkok: workout.start_time_bangkok ?? null,
      title: exercise.title,
      sets: metrics.working_sets, // Backward-compatible numeric alias.
      ...metrics,
      working_set_details: matched.map((set) => ({
        set_index: finiteNumber(set.set_index),
        set_type: set.set_type ?? set.type ?? null,
        weight_kg: nonNegativeNumber(set.weight_kg),
        reps: nonNegativeNumber(set.reps),
        rpe: validRpe(set.rpe),
        distance_meters: nonNegativeNumber(set.distance_meters),
        duration_seconds: nonNegativeNumber(set.duration_seconds),
      })).sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0)),
    };
  }).sort((a, b) => String(a.start_time ?? a.date_bangkok).localeCompare(String(b.start_time ?? b.date_bangkok)) ||
    String(a.workout_id).localeCompare(String(b.workout_id)) || Number(a.exercise_index) - Number(b.exercise_index));
}

export function buildExerciseProgressEntries(catalog: SourceRow[], exercises: SourceRow[], workouts: Map<string, SourceRow>, sets: SourceRow[]) {
  const byIdentity = new Map<string, SourceRow[]>();
  for (const exercise of exercises) {
    const identity = exerciseIdentity(exercise);
    const items = byIdentity.get(identity) || [];
    items.push(exercise);
    byIdentity.set(identity, items);
  }
  return catalog.map((item) => ({
    timezone: "Asia/Bangkok",
    query: item.title,
    title: item.title,
    exercise_template_id: exerciseTemplateId(item),
    identity_source: exerciseTemplateId(item) == null ? "legacy_title" : "exercise_template_id",
    muscle_group: item.muscle_group,
    muscle_attribution: "primary_only",
    sessions: buildExerciseProgressSessions(byIdentity.get(exerciseIdentity(item)) || [], workouts, sets),
  }));
}

export function buildTrainingSummary(workouts: SourceRow[], exercises: SourceRow[], sets: SourceRow[], templates: SourceRow[], days: number) {
  const workoutById = new Map(workouts.map((workout) => [workout.id, workout]));
  const periodExercises = exercises.filter((exercise) => workoutById.has(exercise.workout_id));
  const workingSets = sets.filter((set) => workoutById.has(set.workout_id) && isWorkingSet(set));
  const totals = summarizeWorkingSets(workingSets);
  const totalMinutes = workouts.reduce((sum, workout) => {
    const duration = (new Date(workout.end_time).getTime() - new Date(workout.start_time).getTime()) / 60000;
    return sum + (Number.isFinite(duration) ? Math.max(0, duration) : 0);
  }, 0);
  const templateById = new Map(templates.map((template) => [String(template.id), template]));
  const setsByExercise = indexSets(workingSets);
  const muscleGroups = new Map<string, SourceRow>();
  const catalog = new Map<string, CatalogItem>();

  // Chronological processing makes renamed templates display their latest logged title.
  const orderedExercises = [...periodExercises].sort((a, b) =>
    String(workoutById.get(a.workout_id)?.start_time).localeCompare(String(workoutById.get(b.workout_id)?.start_time)));
  for (const exercise of orderedExercises) {
    const id = exerciseTemplateId(exercise);
    const identity = exerciseIdentity(exercise);
    const sourceMuscle = (id && templateById.get(id)?.primary_muscle_group) || null;
    const muscle = displayMuscleGroup(sourceMuscle);
    const matched = setsByExercise.get(exerciseSetsKey(exercise)) || [];
    const metrics = summarizeWorkingSets(matched);
    const catalogItem: CatalogItem = catalog.get(identity) || {
      exercise_template_id: id,
      identity_source: id == null ? "legacy_title" : "exercise_template_id",
      title: exercise.title,
      muscle_group: muscle,
      muscle_attribution: "primary_only",
      source_muscle: sourceMuscle,
      workout_ids: new Set<string>(),
    };
    catalogItem.title = exercise.title;
    if (matched.length) catalogItem.workout_ids.add(exercise.workout_id);
    catalog.set(identity, catalogItem);
    if (!matched.length) continue;

    const date = workoutById.get(exercise.workout_id)?.start_time || null;
    const aggregate = muscleGroups.get(muscle) || {
      name: muscle, hard_sets: 0, working_sets: 0, volume_kg: 0, workout_ids: new Set<string>(),
      last_trained: null, rpes: [], volume_by_workout: new Map<string, SourceRow>(),
      exercise_strength: new Map<string, Map<string, SourceRow>>(), source_muscles: new Set<string>(),
    };
    aggregate.hard_sets += metrics.hard_sets;
    aggregate.working_sets += metrics.working_sets;
    // Sum unrounded volume so muscle and workout totals agree before presentation rounding.
    const volume = matched.reduce((sum, set) => sum + (nonNegativeNumber(set.weight_kg) ?? 0) * (nonNegativeNumber(set.reps) ?? 0), 0);
    aggregate.volume_kg += volume;
    aggregate.workout_ids.add(exercise.workout_id);
    aggregate.rpes.push(...matched.map((set) => validRpe(set.rpe)).filter((value) => value != null));
    aggregate.source_muscles.add(sourceMuscle || "unknown");
    if (date && (!aggregate.last_trained || date > aggregate.last_trained)) aggregate.last_trained = date;
    const point = aggregate.volume_by_workout.get(exercise.workout_id) || { workout_id: exercise.workout_id, date, volume_kg: 0 };
    point.volume_kg += volume;
    aggregate.volume_by_workout.set(exercise.workout_id, point);
    const bestEstimate = metrics.best_set ? metrics.best_set.weight_kg * (1 + metrics.best_set.reps / 30) : null;
    if (bestEstimate != null && date) {
      const points = aggregate.exercise_strength.get(identity) || new Map<string, SourceRow>();
      const old = points.get(exercise.workout_id);
      if (!old || bestEstimate > old.value) points.set(exercise.workout_id, { date, value: bestEstimate });
      aggregate.exercise_strength.set(identity, points);
    }
    muscleGroups.set(muscle, aggregate);
  }

  const summarizedMuscles = [...muscleGroups.values()].map((aggregate) => {
    const strengthChanges = [...aggregate.exercise_strength.values()].map((points: Map<string, SourceRow>) => {
      const ordered = [...points.values()].sort((a, b) => String(a.date).localeCompare(String(b.date)));
      const first = ordered[0]?.value, last = ordered.at(-1)?.value;
      return ordered.length > 1 && first > 0 && last > 0 ? (last - first) / first * 100 : null;
    }).filter((value): value is number => value != null && Number.isFinite(value));
    return {
      name: aggregate.name,
      muscle_attribution: "primary_only",
      hard_sets: aggregate.hard_sets,
      working_sets: aggregate.working_sets,
      rpe_count: aggregate.rpes.length,
      rpe_coverage_percent: aggregate.working_sets ? Math.round(aggregate.rpes.length / aggregate.working_sets * 100) : 0,
      volume_kg: Math.round(aggregate.volume_kg),
      workout_sessions: aggregate.workout_ids.size,
      last_trained: aggregate.last_trained,
      average_rpe: aggregate.rpes.length ? round(aggregate.rpes.reduce((sum: number, value: number) => sum + value, 0) / aggregate.rpes.length) : null,
      strength_change_percent: strengthChanges.length ? round(strengthChanges.reduce((sum, value) => sum + value, 0) / strengthChanges.length) : null,
      volume_history: [...aggregate.volume_by_workout.values()].sort((a: SourceRow, b: SourceRow) => String(a.date).localeCompare(String(b.date)))
        .map((point: SourceRow) => ({ ...point, volume_kg: Math.round(point.volume_kg) })),
      source_muscles: [...aggregate.source_muscles].sort(),
    };
  }).sort((a, b) => b.hard_sets - a.hard_sets || a.name.localeCompare(b.name));
  const summarizedExercises = [...catalog.values()].map(({ workout_ids, ...item }) => ({ ...item, workout_appearances: workout_ids.size }))
    .sort((a, b) => a.muscle_group.localeCompare(b.muscle_group) || b.workout_appearances - a.workout_appearances || a.title.localeCompare(b.title));
  return {
    timezone: "Asia/Bangkok", period_days: days, workouts: workouts.length,
    completed_sets: totals.working_sets,
    working_sets: totals.working_sets,
    total_volume_kg: totals.volume_kg,
    average_rpe: totals.average_rpe,
    rpe_count: totals.rpe_count,
    rpe_coverage_percent: totals.rpe_coverage_percent,
    total_training_minutes: Math.round(totalMinutes),
    most_frequent_exercises: [...summarizedExercises].sort((a, b) => b.workout_appearances - a.workout_appearances).slice(0, 10)
      .map((item) => ({ title: item.title, exercise_template_id: item.exercise_template_id, identity_source: item.identity_source, workout_appearances: item.workout_appearances })),
    muscle_groups: summarizedMuscles,
    exercise_catalog: summarizedExercises,
    muscle_attribution: "primary_only",
    calculation_policy: { set_scope: "working_sets_excluding_warmup", rpe_min: 1, rpe_max: 10, hard_set_rpe_min: 7, muscle_attribution: "primary_only", missing_numeric_values: "null" },
  };
}
