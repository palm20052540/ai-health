import { finiteNumber, sessionDate, templateId, isWorkingSet } from "./trainingModel.js";

function reliableEffort(session) {
  const average = finiteNumber(session?.average_rpe), count = finiteNumber(session?.rpe_count);
  const sets = finiteNumber(session?.working_sets ?? session?.completed_sets ?? session?.sets);
  const reported = finiteNumber(session?.rpe_coverage_percent);
  if (Array.isArray(session?.working_set_details)) {
    const details = session.working_set_details.filter(isWorkingSet);
    const rpes = details.map(item => finiteNumber(item.rpe)).filter(value => value >= 1 && value <= 10);
    if (details.length !== sets || rpes.length !== count || !rpes.length || Math.abs(rpes.reduce((sum, value) => sum + value, 0) / rpes.length - average) > .15) return null;
  }
  return average >= 1 && average <= 10 && Number.isInteger(count) && Number.isInteger(sets) && sets > 0 && count > 0 && count <= sets && count / sets >= .8 && reported != null && reported === Math.round(count / sets * 100) ? Math.round(average * 10) / 10 : null;
}

function reliableTopSet(session) {
  const top = session?.best_set;
  if (!top || !isWorkingSet(top)) return false;
  if (!Array.isArray(session.working_set_details)) return true;
  const working = session.working_set_details.filter(isWorkingSet).filter(set => finiteNumber(set.weight_kg) > 0 && finiteNumber(set.reps) > 0);
  const estimate = set => finiteNumber(set.weight_kg) * (1 + finiteNumber(set.reps) / 30);
  const best = working.reduce((found, set) => !found || estimate(set) > estimate(found) ? set : found, null);
  return Boolean(best && finiteNumber(best.weight_kg) === finiteNumber(top.weight_kg) && finiteNumber(best.reps) === finiteNumber(top.reps));
}

// Describes the matched log, never clears training or sets a new load target.
export function exerciseCoach(exercise, now = Date.now()) {
  const current = exercise?.current, previous = exercise?.previous, id = exercise?.exercise_template_id;
  const fallback = { label: "Comparison needed", tone: "neutral", progress: "No clear comparison yet.", focus: "Repeat a well-recorded session before judging the trend." };
  if (!id || templateId(current) !== id || templateId(previous) !== id || !current?.workout_id || !previous?.workout_id || current.workout_id === previous.workout_id || !sessionDate(current) || !sessionDate(previous) || sessionDate(current) <= sessionDate(previous) || Date.parse(sessionDate(current)) > now) return fallback;
  if (!reliableTopSet(current) || !reliableTopSet(previous)) return fallback;
  const load = finiteNumber(current.best_set?.weight_kg), priorLoad = finiteNumber(previous.best_set?.weight_kg), reps = finiteNumber(current.best_set?.reps), priorReps = finiteNumber(previous.best_set?.reps);
  if ([load, priorLoad, reps, priorReps].some(value => value == null || value < 0) || !Number.isInteger(reps) || !Number.isInteger(priorReps) || reps < 1 || priorReps < 1) return fallback;
  const effort = reliableEffort(current), priorEffort = reliableEffort(previous);
  if (effort == null || priorEffort == null) return { label: "Effort incomplete", tone: "neutral", progress: load === priorLoad ? reps === priorReps ? "Same top set; effort is incomplete." : `${reps > priorReps ? "More" : "Fewer"} reps at the same load; effort is incomplete.` : "The load changed; effort is incomplete.", focus: "Keep logging RPE before treating this as progress." };
  const sets = finiteNumber(current.working_sets ?? current.completed_sets ?? current.sets), priorSets = finiteNumber(previous.working_sets ?? previous.completed_sets ?? previous.sets);
  if (load !== priorLoad || sets !== priorSets) return { label: "Mixed comparison", tone: "mixed", progress: load !== priorLoad ? "The recorded load changed; review the reps and average effort alongside it." : "The working-set count changed, so effort is not directly comparable.", focus: "Keep technique consistent and review the session plan before adjusting." };
  if (load === priorLoad && reps === priorReps) return { label: effort < priorEffort ? "Same work, easier" : effort > priorEffort ? "Same work, harder" : "Holding steady", tone: effort > priorEffort ? "caution" : "steady", progress: effort < priorEffort ? "Same load and reps, with lower logged effort." : effort > priorEffort ? "Same load and reps, with higher logged effort." : "Load, reps and logged effort held steady.", focus: "Keep technique consistent; check recovery before changing the target." };
  if (load === priorLoad && reps > priorReps && effort <= priorEffort) return { label: "Progress in this log", tone: "positive", progress: "More reps at the same load without higher logged effort.", focus: "Repeat the quality; use the session plan for any target change." };
  if (reps < priorReps && effort < priorEffort) return { label: "Mixed change", tone: "mixed", progress: "Fewer reps with lower average effort; the result is not directly comparable.", focus: "Review the session plan and keep the next comparison consistent." };
  return { label: load === priorLoad && reps < priorReps ? "Reps dipped" : "Mixed change", tone: "caution", progress: load === priorLoad ? `${reps < priorReps ? "Fewer reps" : "More reps with higher effort"} at the same load.` : "Load, reps or effort traded off; progress is not clear yet.", focus: "Check recovery and aim for a comparable, controlled effort." };
}

export function dailyFocus(themes = [], dataState = "missing") {
  if (dataState !== "live") return { title: "Refresh before deciding", action: "Current evidence is not ready. Keep today’s training decision on hold." };
  const readiness = themes.find(item => item.id === "training_readiness");
  if (!readiness || readiness.rating === "insufficient") return { title: "Check recovery first", action: "The data cannot set today’s training effort. Complete your check-in." };
  if (readiness.rating === "caution") return { title: "Start easy, then reassess", action: "Complete your Recovery check-in before choosing today’s effort." };
  return { title: "Make consistency the goal", action: "Complete your Recovery check-in, then use your session plan." };
}

export function sessionFocus(exercises = []) {
  const results = exercises.map(exercise => exerciseCoach(exercise));
  const positives = results.filter(item => item.tone === "positive").length;
  const cautions = results.filter(item => item.tone === "caution").length;
  const steady = results.filter(item => item.tone === "steady").length;
  const mixed = results.filter(item => item.tone === "mixed").length;
  return { title: positives && (cautions || mixed) ? "A mixed session" : positives ? "Progress in matched exercises" : cautions ? "Review the tougher comparisons" : mixed ? "Some changes to review" : steady ? "Holding your standard" : "Build a clearer comparison", detail: `${positives} improved log comparisons · ${steady} steady · ${mixed} mixed · ${cautions} tougher · ${results.length - positives - steady - cautions - mixed} incomplete`, action: "Check Recovery, then open Next session plan for today’s targets." };
}
