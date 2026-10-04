import { buildExerciseProgressSessions, finiteNumber, summarizeWorkingSets, type SourceRow } from "./analytics.ts";

const DAY = 86400000;
export const CHAT_HISTORY_DAYS = 30;
export function sourceId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value);
}
function instant(value: unknown): string | null {
  if (typeof value !== "string" || !value || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function label(value: unknown): string {
  // Source labels are data, never instructions. Strip markup/control characters.
  return typeof value === "string" ? value.replace(/[<>\p{Cc}\p{Cf}]/gu, "").slice(0, 100) : "Exercise";
}
function compactWorkout(row: SourceRow) {
  return { id: row.id, title: label(row.title), start_time: instant(row.start_time), end_time: instant(row.end_time) };
}
export function compactLiveRoutine(value:SourceRow,expectedId:string,now=Date.now()) {
  const routine=value?.routine||value;
  if(routine?.id!==expectedId||!Array.isArray(routine.exercises)||!routine.exercises.length||routine.exercises.length>100)throw new Error('The live routine is unavailable');
  return {id:expectedId,title:label(routine.title),fetched_at:new Date(now).toISOString(),exercises:routine.exercises.map((exercise:SourceRow,index:number)=>{
    if(!Array.isArray(exercise.sets)||exercise.sets.length>300)throw new Error('Routine sets are unavailable');
    return {exercise_index:index,exercise_template_id:sourceId(exercise.exercise_template_id)?exercise.exercise_template_id:null,title:label(exercise.title),
      sets:exercise.sets.map((set:SourceRow)=>({set_type:set.type??null,weight_kg:finiteNumber(set.weight_kg),reps:finiteNumber(set.reps),rep_range_start:finiteNumber(set.rep_range?.start),rep_range_end:finiteNumber(set.rep_range?.end),rpe:finiteNumber(set.rpe),distance_meters:finiteNumber(set.distance_meters),duration_seconds:finiteNumber(set.duration_seconds)}))};
  })};
}

/** A single bounded SQL snapshot. No health history, notes, tokens or raw payloads. */
export function buildChatTrainingEvidence(raw: SourceRow | null, now = Date.now()) {
  const unavailable = (reason: string) => ({ version: "chat-training-v1", dataState: "unavailable", periodDays: CHAT_HISTORY_DAYS, reason });
  if (raw?.incomplete) return unavailable("A selected workout is still being imported or its exercise/set records are incomplete. Retry after a completed source sync.");
  if (!raw || !["workout", "routine"].includes(raw.mode) || raw.truncated) return unavailable("The requested source is missing or exceeds the bounded evidence limit.");
  if(raw.mode==='routine'&&(!sourceId(raw.routine?.id)||!raw.catalog?.length))return unavailable('A current, nonempty Hevy routine is required.');
  const anchor = instant(raw.anchor_at), syncedAt = instant(raw.last_success_at);
  if (!anchor || Date.parse(anchor) > now + 60000) return unavailable("The comparison window has no valid source time.");
  const windowStart = Date.parse(anchor) - CHAT_HISTORY_DAYS * DAY;
  const rows: SourceRow[] = Array.isArray(raw.workouts) ? raw.workouts : [];
  const exercises: SourceRow[] = Array.isArray(raw.exercises) ? raw.exercises : [];
  const sets: SourceRow[] = Array.isArray(raw.sets) ? raw.sets : [];
  if (rows.length > 100 || exercises.length > 1500 || sets.length > 10000 || !Array.isArray(raw.catalog) || raw.catalog.length > 100) return unavailable("The source exceeds the bounded evidence limit.");
  const targetId = raw.mode === "workout" ? raw.target?.id : null;
  if (raw.mode === "workout" && (!sourceId(targetId) || !instant(raw.target.end_time) || Date.parse(raw.target.end_time) < Date.parse(anchor) || Date.parse(raw.target.end_time) > now + 60000)) return unavailable("No completed workout is available.");
  const workouts = rows.filter((row) => sourceId(row.id) && instant(row.start_time) && instant(row.end_time) && Date.parse(row.end_time) <= now + 60000 && (row.id === targetId || Date.parse(row.start_time) >= windowStart && Date.parse(row.start_time) < Date.parse(anchor)));
  if (new Set(workouts.map((row) => row.id)).size !== workouts.length || targetId && !workouts.some((row) => row.id === targetId)) return unavailable("Workout identity is missing or ambiguous.");
  const map = new Map(workouts.map((row) => [row.id, row]));
  const cleanExercises = exercises.filter((row) => map.has(row.workout_id)).map((row) => ({ workout_id: row.workout_id, exercise_index: row.exercise_index, exercise_template_id: sourceId(row.exercise_template_id) ? row.exercise_template_id : null, title: label(row.title) }));
  const sessions = buildExerciseProgressSessions(cleanExercises, map, sets);
  const catalog: SourceRow[] = raw.catalog;
  const entries = catalog.map((exercise) => {
    const id = sourceId(exercise.exercise_template_id) ? exercise.exercise_template_id : null;
    const matched = id ? sessions.filter((row) => row.exercise_template_id === id) : [];
    const current = targetId ? sessions.filter((row) => row.workout_id === targetId && row.exercise_index === exercise.exercise_index) : [];
    const history = matched.filter((row) => row.workout_id !== targetId);
    const ambiguous = !id || catalog.filter((row) => row.exercise_template_id === id).length !== 1 || new Set(history.map((row) => row.workout_id)).size !== history.length || targetId && current.length !== 1;
    return {
      exercise_template_id: id, exercise_index: exercise.exercise_index, title: label(exercise.title),
      current: targetId ? current[0] || null : null,
      history: ambiguous ? [] : history,
      comparable: !ambiguous && history.length > 0,
      reason: ambiguous ? "Stable exercise identity is missing or repeated; no cross-session comparison is made." : history.length ? null : "No earlier same-exercise session is available in this thirty-day window.",
      ...(raw.mode === "routine" ? { routine_sets: (Array.isArray(exercise.sets) ? exercise.sets : []).map((set: SourceRow) => ({ set_type: set.set_type, weight_kg: set.weight_kg, reps: set.reps, rep_range_start: set.rep_range_start, rep_range_end: set.rep_range_end, rpe: set.rpe, distance_meters:set.distance_meters,duration_seconds:set.duration_seconds })) } : {}),
    };
  });
  const routineFetched=raw.mode==='routine'?instant(raw.routine?.fetched_at):null;
  const syncCurrent = syncedAt && Date.parse(syncedAt) <= now + 60000 && now - Date.parse(syncedAt) <= 2 * DAY && (raw.mode!=='routine'||routineFetched&&Date.parse(routineFetched)<=now+60000&&now-Date.parse(routineFetched)<15*60000);
  const target = raw.target ? compactWorkout(raw.target) : null;
  const overall = targetId ? summarizeWorkingSets(sets.filter((set) => set.workout_id === targetId)) : null;
  return {
    version: "chat-training-v1", dataState: syncCurrent ? "live" : "stale", periodDays: CHAT_HISTORY_DAYS,
    window: { from: new Date(windowStart).toISOString(), before: anchor, semantics: "Previous thirty days before the selected workout; pre-workout uses the current read time." },
    generatedAt: new Date(now).toISOString(), lastSuccessfulSyncAt: syncedAt,
    workout: target, routine: raw.mode === "routine" ? { id: raw.routine.id, title: label(raw.routine.title),fetchedAt:routineFetched,source:"Live Hevy routine read" } : null,
    overall, exercises: entries,
    coverage: { availableWorkouts: workouts.length, earliestAvailableAt: workouts.map((row) => instant(row.start_time)).filter(Boolean).sort()[0] || null, requestedDaysIsNotProofOfHistory: true },
    interpretation: { workingSetsExcludeWarmups: true, rpeIsAlreadyLogged: true, volumeAloneIsNotProgress: true, loadMayRepresentAssistance: true, localGoalAndCheckInIncluded: false },
  };
}

export async function readChatTrainingEvidence(db: { rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: SourceRow | null; error: unknown }> }, userId: string, workoutId: string | null, routineId: string | null, now = Date.now(),liveRoutine:SourceRow|null=null) {
  if (workoutId != null && !sourceId(workoutId) || routineId != null && !sourceId(routineId) || workoutId && routineId) throw Object.assign(new Error("Choose one valid workout or routine ID."), { status: 400 });
  const result = await db.rpc("get_chat_training_evidence", { p_user_id: userId, p_workout_id: workoutId, p_routine_id: routineId,p_live_routine:liveRoutine });
  if (result.error) throw new Error("The compact training evidence could not be read.");
  const evidence=buildChatTrainingEvidence(result.data, now);
  const stable={...evidence} as Record<string,unknown>;
  delete stable.generatedAt; delete stable.lastSuccessfulSyncAt;
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(stable)));
  const sourceHash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return {...evidence,sourceHash};
}
