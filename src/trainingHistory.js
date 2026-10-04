import { finiteNumber, isWorkingSet, sessionDate, templateId } from "./trainingModel.js";
import { daysForRange, isSamplePayload } from "./portalData.js";

export function exerciseHistory(payload, id) {
  if (!id || isSamplePayload(payload)) return { name: "Exercise", sessions: [] };
  const entries = (payload?.exercise_progress || []).filter((row) => templateId(row) === id);
  return { exercise_template_id: id, name: entries[0]?.query || entries[0]?.title || "Exercise", sessions: entries.flatMap((row) => row.sessions || []).filter((row) => templateId(row) === id) };
}
export function workingRecords(session) {
  return (session?.working_set_details || []).filter(isWorkingSet).slice().sort((a, b) => (finiteNumber(a.set_index) ?? Infinity) - (finiteNumber(b.set_index) ?? Infinity));
}
export function trainingHistory(payload, range = "30D") {
  if (!payload || isSamplePayload(payload)) return [];
  const end = Date.parse(payload.generated_at || ""), start = end - daysForRange(range) * 86400000;
  if (!Number.isFinite(end)) return [];
  const workouts = new Map();
  for (const entry of payload.exercise_progress || []) for (const session of entry.sessions || []) {
    const id = session.workout_id, date = sessionDate(session), time = Date.parse(date || "");
    if (typeof id !== "string" || !id || !Number.isFinite(time) || time < start || time > end) continue;
    if (!workouts.has(id)) workouts.set(id, { id, date, title: "Recorded workout", exercises: [] });
    workouts.get(id).exercises.push({ key: `${templateId(entry) || "unknown"}-${session.exercise_index ?? "unknown"}-${workouts.get(id).exercises.length}`, name: session.title || entry.query || "Exercise", session });
  }
  for (const workout of payload.recent_workouts || []) {
    const id = workout.id || workout.workout_id, date = sessionDate(workout), time = Date.parse(date || "");
    if (typeof id !== "string" || !id || !Number.isFinite(time) || time < start || time > end) continue;
    const found = workouts.get(id) || { id, date, exercises: [] };
    workouts.set(id, { ...found, title: workout.title || "Recorded workout", summary: workout });
  }
  return [...workouts.values()].sort((a, b) => Date.parse(b.date) - Date.parse(a.date) || a.id.localeCompare(b.id));
}
