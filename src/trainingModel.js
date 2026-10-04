import { sourceInstant } from "./dates.js";
// Decision support only. Missing evidence never becomes a zero or an instruction to progress.
const DAY = 86400000;
export const PROGRESS_RANGES = [
  { value: "30D", label: "1M", days: 30 },
  { value: "3M", label: "3M", days: 90 },
  { value: "6M", label: "6M", days: 180 },
  { value: "1Y", label: "12M", days: 365 },
];

export function finiteNumber(value) {
  if (value == null || !["number", "string"].includes(typeof value) || (typeof value === "string" && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isWorkingSet(set) {
  return String(set.set_type ?? set.type ?? '').trim().toLowerCase().replace(/[-_\s]/g, '') !== 'warmup';
}

export function templateId(value) {
  const id = value?.exercise_template_id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

export function sessionDate(session) {
  return sourceInstant(session?.start_time || session?.start_time_bangkok || session?.date_bangkok || session?.date);
}

function timestamp(value) {
  if (!value) return null;
  const stamp = Date.parse(String(value).length === 10 ? `${value}T00:00:00+07:00` : value);
  return Number.isFinite(stamp) ? stamp : null;
}

function ordered(sessions = []) {
  return sessions.slice().sort((a, b) => (timestamp(sessionDate(a)) ?? 0) - (timestamp(sessionDate(b)) ?? 0));
}

export function rpeCoverage(session) {
  const average = finiteNumber(session?.average_rpe);
  const workingSets = finiteNumber(session?.working_sets ?? session?.completed_sets ?? session?.sets);
  const count = finiteNumber(session?.rpe_count);
  const rawPercent = finiteNumber(session?.rpe_coverage_percent);
  const percent = rawPercent ?? (count != null && workingSets > 0 ? 100 * count / workingSets : null);
  return {
    average: average != null && average >= 1 && average <= 10 ? average : null,
    count, workingSets,
    percent: percent != null && percent >= 0 && percent <= 100 ? percent : null,
  };
}

export function routineList(payload) {
  const items = Array.isArray(payload) ? payload : payload?.routines ?? payload?.data;
  return Array.isArray(items) ? items.filter((item) => item?.id != null) : [];
}

export function routineDetail(payload) {
  return payload?.routine || payload?.data?.routine || payload?.data || payload;
}

function safeHistory(exerciseId, progress = []) {
  if (!exerciseId) return [];
  // Both the catalog row and each session must assert the same stable identity.
  return ordered(progress.filter((item) => templateId(item) === exerciseId)
    .flatMap((item) => item.sessions || []).filter((session) => templateId(session) === exerciseId));
}

function comparison(current, previous) {
  if (!previous) return "No earlier session with the same exercise ID in this range.";
  const load = finiteNumber(current.best_set?.weight_kg), previousLoad = finiteNumber(previous.best_set?.weight_kg);
  const reps = finiteNumber(current.best_set?.reps), previousReps = finiteNumber(previous.best_set?.reps);
  const currentRpe = rpeCoverage(current), previousRpe = rpeCoverage(previous);
  if ([load, previousLoad, reps, previousReps].some((value) => value == null)) return "Load or rep evidence is incomplete; a performance comparison is unavailable.";
  const effort = currentRpe.average == null || previousRpe.average == null || currentRpe.percent == null || previousRpe.percent == null
    ? "Effort coverage is incomplete, so this is descriptive only."
    : `Average RPE ${previousRpe.average.toFixed(1)} → ${currentRpe.average.toFixed(1)} (${Math.round(previousRpe.percent)}% → ${Math.round(currentRpe.percent)}% coverage).`;
  if (load === previousLoad) {
    const delta = reps - previousReps;
    return `${delta > 0 ? `${delta} more` : delta < 0 ? `${Math.abs(delta)} fewer` : "The same number of"} top-set reps at the same ${load} kg. ${effort}`;
  }
  return `Top set changed from ${previousLoad} kg × ${previousReps} to ${load} kg × ${reps}. Different loads need rep and effort context. ${effort}`;
}

export function buildLatestSessionReview(payload) {
  const workouts = ordered(payload?.recent_workouts || []).reverse();
  const latest = workouts[0] || null;
  if (!latest) return { latest: null, previous: null, exercises: [], narrative: "No completed workout is available to review." };
  const workoutId = latest.id || latest.workout_id;
  const progress = payload?.exercise_progress || [];
  const exercises = progress.flatMap((exercise, index) => {
    const id = templateId(exercise);
    const rows = (exercise.sessions || []).filter((session) => session.workout_id === workoutId);
    if (!rows.length) return [];
    const current = ordered(rows).at(-1);
    const history = safeHistory(id, progress);
    const previous = history.filter((session) => session.workout_id !== workoutId && timestamp(sessionDate(session)) != null && timestamp(sessionDate(session)) < timestamp(sessionDate(current))).at(-1) || null;
    const ambiguous = rows.length !== 1 || timestamp(sessionDate(current)) == null || !id || templateId(current) !== id || history.filter((session) => session.workout_id === workoutId).length !== 1;
    return [{
      key: id || `unidentified-${index}`, exercise_template_id: id,
      name: exercise.query || exercise.name || current.title || "Exercise", current,
      previous: ambiguous ? null : previous,
      narrative: ambiguous ? "Exercise identity or repeated entries are ambiguous; no cross-session comparison is made." : comparison(current, previous),
    }];
  });
  return {
    latest, previous: workouts[1] || null, exercises,
    narrative: "Working-set volume describes the amount logged. More volume alone does not establish better performance; compare the same exercise, load, reps, effort, and recovery.",
  };
}

function goalSettings(settings) {
  const goal = settings?.goals?.primary || "General fitness";
  const style = settings?.training?.style || "";
  const text = `${goal} ${style}`.toLowerCase();
  if (/strength/.test(text)) return { goal, repMin: 3, repMax: 6, reason: `${goal}: prioritize repeatable technique and load quality; no automatic load increase.` };
  if (/endurance/.test(text)) return { goal, repMin: 12, repMax: 20, reason: `${goal}: controlled reps and manageable effort take priority over load.` };
  return { goal, repMin: 6, repMax: 12, reason: `${goal}: preserve the routine's set budget and use gradual rep progression when evidence supports it.` };
}

function baselinePrescription(exercise) {
  const sets = (exercise.sets || []).filter(isWorkingSet);
  const loads = sets.map((set) => finiteNumber(set.weight_kg));
  const reps = sets.map((set) => finiteNumber(set.reps) ?? finiteNumber(set.rep_range?.start));
  const uniform = sets.length > 0 && loads.every((load) => load != null && load === loads[0]) && reps.every((rep) => rep != null && rep === reps[0]);
  return {
    loadKg: uniform ? loads[0] : null, sets: sets.length || null, reps: uniform ? reps[0] : null,
    uniform, setDetails: sets.map((set) => ({
      loadKg: finiteNumber(set.weight_kg), reps: finiteNumber(set.reps),
      repMin: finiteNumber(set.rep_range?.start), repMax: finiteNumber(set.rep_range?.end), rpe: finiteNumber(set.rpe),
    })),
  };
}

export function buildNextSessionPlan({ routine, payload, settings = {}, recovery, dataState = "live", now = Date.now() }) {
  const goal = goalSettings(settings);
  const targetRpe = Math.min(10, Math.max(0, finiteNumber(settings.training?.targetRpe) ?? 8));
  const maxRpe = Math.min(10, Math.max(0, finiteNumber(settings.training?.maxRpe) ?? 9));
  const cap = Math.min(targetRpe, maxRpe);
  const generated = timestamp(payload?.generated_at);
  const synced = timestamp(payload?.recap?.freshness?.hevy?.synced_at);
  const dataFresh = generated != null && synced != null && now - generated <= 2 * DAY && now - synced <= 2 * DAY && generated <= now + DAY && synced <= now + DAY;
  const applied = timestamp(recovery?.appliedAt);
  const recoveryCurrent = Boolean(recovery && !recovery.stale && applied != null && now - applied < DAY && applied <= now + 60000);
  const painValue = recovery?.input?.painSeverity;
  const pain = (finiteNumber(painValue) ?? 0) > 0;
  const fatigueValue = recovery?.input?.fatigue;
  const fatigue = (finiteNumber(fatigueValue) ?? 0) >= 5 || /high|severe|very/i.test(String(fatigueValue || ""));
  const progress = payload?.exercise_progress || [];
  const rows = (routine?.exercises || []).map((exercise, index) => {
    const id = templateId(exercise);
    const history = safeHistory(id, progress);
    const recent = history.slice(-2);
    const latest = recent.at(-1);
    const previous = recent[0];
    const evidence = recent.map(rpeCoverage);
    const baseline = baselinePrescription(exercise);
    const row = {
      key: `${id || "missing-id"}-${index}`, exercise_template_id: id,
      name: exercise.title || exercise.exercise_template?.title || progress.find((entry) => templateId(entry) === id && id)?.query || `Exercise ${index + 1}`,
      status: "abstain", label: "Keep routine as reference", baseline, prescription: { ...baseline },
      targetRpe: cap, history: recent, reasons: [goal.reason], editable: true,
    };
    const abstain = (reason) => { row.reasons.push(reason); return row; };
    if (pain) {
      row.editable = false; row.label = "Pain reported: no automatic target";
      row.prescription = { loadKg: null, sets: null, reps: null };
      return abstain("Do not increase through pain. Skip painful movements and review with a qualified clinician when pain is persistent, severe, or unusual.");
    }
    if (recoveryCurrent && recovery.decision === "rest") {
      row.status = "rest"; row.label = "Rest today"; row.editable = false;
      row.prescription = { loadKg: null, sets: 0, reps: null };
      return abstain("The current recovery decision is rest. No working sets are proposed.");
    }
    if (dataState !== "live" || !payload || payload.demo || payload.sample || payload.is_sample || ["sample", "demo"].includes(payload.data_state) || ["sample", "demo"].includes(payload.mode)) return abstain("Live history is unavailable. Existing routine values are a reference, not a recommendation.");
    if (!dataFresh) return abstain("Training freshness is missing or older than 48 hours. Refresh before using an automatic prescription.");
    if (!id) return abstain("The routine has no stable exercise ID. History is not joined by exercise name.");
    if (recent.length < 2 || recent.some((session) => !session.workout_id) || recent[0].workout_id === recent[1].workout_id) return abstain("At least two distinct sessions with the same stable exercise ID are needed.");
    if (new Set(history.map((item) => item.workout_id)).size !== history.length) return abstain("Repeated entries for this exercise in a workout need review before automatic planning.");
    if (recent.some((session) => timestamp(sessionDate(session)) == null || now - timestamp(sessionDate(session)) > 14 * DAY || timestamp(sessionDate(session)) > now + DAY)) return abstain("Two sessions from the past 14 days are needed; older or undated history is not used to increase targets.");
    if (evidence.some((item) => item.average == null || item.percent == null || item.percent < 80 || !(item.workingSets > 0))) return abstain("RPE coverage is missing or below 80% in one of the last two sessions. No automatic progression.");
    row.reasons.push(`Last two sessions: RPE ${evidence.map((item) => item.average.toFixed(1)).join(" → ")}; ${evidence.map((item) => `${Math.round(item.percent)}%`).join(" → ")} working-set coverage.`);
    if (!recoveryCurrent || !["train", "reduce", "rest"].includes(recovery?.decision)) return abstain("Apply a current recovery check-in before using an automatic prescription.");
    if (finiteNumber(painValue) == null || finiteNumber(fatigueValue) == null) return abstain("Explicit pain and fatigue ratings are needed in the current recovery check-in.");
    if (!baseline.uniform || baseline.loadKg == null || baseline.reps == null) return abstain("This routine has varied or incomplete working-set targets. Keep the per-set reference and review it manually.");
    const latestLoad = finiteNumber(latest.best_set?.weight_kg), previousLoad = finiteNumber(previous.best_set?.weight_kg);
    const latestReps = finiteNumber(latest.best_set?.reps), previousReps = finiteNumber(previous.best_set?.reps);
    if ([latestLoad, previousLoad, latestReps, previousReps].some((value) => value == null)) return abstain("Comparable loaded top-set reps are missing. Routine targets remain a reference only.");
    const observedSets = Math.min(...evidence.map((item) => item.workingSets));
    row.prescription = { ...baseline, loadKg: Math.min(baseline.loadKg, latestLoad), reps: Math.min(baseline.reps, latestReps), sets: Math.min(baseline.sets, observedSets) };
    if (recovery.decision === "reduce" || fatigue || evidence.some((item) => item.average > maxRpe)) {
      row.status = "reduce"; row.label = "Reduce effort";
      row.prescription = { ...row.prescription, loadKg: Math.floor(row.prescription.loadKg * .9 * 2) / 2, sets: Math.max(1, row.prescription.sets - 1) };
      row.reasons.push(`${recovery.decision === "reduce" ? "Recovery calls for a lighter session" : fatigue ? "High fatigue was reported" : "Recent effort exceeded your RPE cap"}: one fewer set and about 10% less reference load; stop if symptoms appear.`);
      return row;
    }
    row.status = "hold"; row.label = "Repeat controlled targets";
    const canAddRep = recovery.decision === "train" && evidence.every((item) => item.average < cap) && latestLoad === previousLoad && latestLoad === baseline.loadKg && latestReps >= previousReps && latestReps >= baseline.reps && baseline.reps < goal.repMax;
    if (canAddRep) {
      row.status = "optional-progression"; row.label = "Optional rep progression";
      row.prescription.reps = Math.min(baseline.reps + 1, goal.repMax);
      row.reasons.push(`Try one extra rep at the same load only while technique remains controlled and effort stays at or below RPE ${cap}. Repeating the baseline is also valid.`);
    } else row.reasons.push(`Keep load steady. Recent reps, effort, or the ${goal.repMin}–${goal.repMax} rep emphasis do not support an automatic increase; aim at or below RPE ${cap}.`);
    return row;
  });
  return {
    routineId: routine?.id || null, title: routine?.title || "Selected routine", goal: goal.goal, rows,
    recoveryLabel: recoveryCurrent ? recovery?.decision || "unknown" : "check-in required",
    summary: "This is a local, editable draft. There is no required session-load increase and nothing is written to Hevy.",
  };
}

export function buildProgressCoverage(payload, range = "30D", now = Date.now()) {
  const requestedDays = PROGRESS_RANGES.find((item) => item.value === range)?.days || 30;
  const sessions = (payload?.exercise_progress || []).flatMap((item) => item.sessions || [])
    .filter((item) => { const date = timestamp(sessionDate(item)); return date != null && date >= now - requestedDays * DAY && date <= now; });
  const dates = sessions.map(sessionDate).sort((a, b) => timestamp(a) - timestamp(b));
  const workouts = new Set(sessions.map((item) => item.workout_id).filter(Boolean));
  const observedDays = dates.length ? Math.min(requestedDays, Math.floor((timestamp(dates.at(-1)) - timestamp(dates[0])) / DAY) + 1) : 0;
  const training = payload?.recap?.summary?.training || {};
  const reportedDays = finiteNumber(payload?.period?.days ?? training.period_days);
  const incompleteRange = reportedDays != null && reportedDays < requestedDays;
  return {
    requestedDays, observedDays, workouts: workouts.size, first: dates[0] || null, last: dates.at(-1) || null,
    rpePercent: finiteNumber(training.rpe_coverage_percent), incompleteRange,
    narrative: !dates.length ? `No recorded exercise sessions are available in this ${requestedDays}-day window.`
      : `${workouts.size} recorded workouts span ${observedDays} of the requested ${requestedDays} days. ${incompleteRange ? `The returned dataset covers only ${reportedDays} days. ` : ""}${observedDays < requestedDays ? "Partial observed history; a longer selected window does not create older evidence." : "Observed span does not prove every day or workout was recorded."}`,
  };
}

export function buildRoutinePayload(detail, recommendation, create = false) {
  const id = templateId(recommendation);
  if (!id) throw new Error("A stable exercise ID is required; matching by name is not supported.");
  if (!(detail.exercises || []).some((exercise) => templateId(exercise) === id)) throw new Error("The selected exercise ID is not present in this routine.");
  const load = finiteNumber(recommendation.load);
  const numbers = String(recommendation.reps || "").match(/\d+/g)?.map(Number) || [];
  return {
    title: create ? `${detail.title} · adjusted` : detail.title,
    folder_id: detail.folder_id ?? null, notes: detail.notes ?? null,
    exercises: (detail.exercises || []).map((exercise) => ({
      exercise_template_id: exercise.exercise_template_id, rest_seconds: exercise.rest_seconds ?? null,
      notes: exercise.notes ?? null, superset_id: exercise.superset_id ?? null,
      sets: (exercise.sets || []).map((set) => {
        const match = templateId(exercise) === id && isWorkingSet(set);
        return {
          type: set.type || set.set_type || "normal",
          weight_kg: match && load != null ? load : set.weight_kg ?? null,
          reps: set.reps ?? null, rep_range: match && numbers.length ? { start: numbers[0], end: numbers[1] ?? numbers[0] } : set.rep_range ?? null,
          rpe: set.rpe ?? null, distance_meters: set.distance_meters ?? null,
          duration_seconds: set.duration_seconds ?? null, custom_metric: set.custom_metric ?? null,
        };
      }),
    })),
  };
}

// A refreshed response timestamp or temporary cache state must not erase an edit.
// Genuine routine/evidence, goal, or applied-check-in changes invalidate the draft.
export function trainingDraftContext({ selected, routine, payload, settings, recovery }) {
  return JSON.stringify({ selected, routine, settings,
    evidence: { freshness: payload?.recap?.freshness, summary: payload?.recap?.summary, records: payload?.recap?.evidence, exercises: payload?.exercise_progress },
    checkIn: { input: recovery?.input, appliedAt: recovery?.appliedAt, contextKey: recovery?.contextKey },
  });
}
