import { buildBriefSnapshot, buildRulesBrief, sanitizeBriefSnapshot, validateBriefResponse } from "./dailyBrief.js";
import { sourceInstant } from "./dates.js";
import { finiteNumber, isWorkingSet } from "./trainingModel.js";

// Pure contract shared by the authenticated report reader and writer. No network,
// credentials, raw records, profile data or paid model integration belongs here.
export const REPORT_VERSION = "assistant-report-v1";
const DAY = 86400000;
const FRESH = 2 * DAY;
const MAX_EXERCISES = 40;
const MAX_HISTORY = 120;
const MAX_SETS = 100;
const STATES = ["live", "missing", "stale", "sample", "loading"];
const SNAPSHOT_KEYS = ["version", "dataState", "periodDays", "freshness", "sourceSyncedAt", "sleep", "hrv", "restingHeartRate", "steps", "training"];
const SESSION_KEYS = ["at", "workingSets", "loadKg", "reps", "averageRpe", "rpeCount", "rpeCoveragePercent"];
const SIGNAL_KEYS = ["sleep", "hrv", "restingHeartRate", "steps", "training"];
// Free prose is deliberately conservative. Numerical observations live in fixed
// evidence strings; descriptions must not turn them into a prescription.
const UNSAFE = /\b(?:diagnos\w*|prescrib\w*|testosterone|steroid\w*|hormone\w*|medication\w*|drug\w*|dosage|supplement\w*|cure[ds]?|disease|diabetes|cancer|arrhythmia|hypertension|overtraining syndrome|anemia|infection|injur\w*|pain|creatine|caffeine|melatonin|vitamin\w*|ibuprofen|aspirin|paracetamol|acetaminophen|protein powder|volume|tonnage)\b|\b(?:guaranteed|certainly healthy|safe to exercise|cleared for exercise)\b|https?:\/\/|<[^>]*>|\b(?:increase|raise|add|double|bump|progress|advance)\b.{0,45}\b(?:load|weight|kg|sets?|reps?|intensity)\b|\b(?:heavier|automatic progression|automatic prescription)\b|\b(?:start|stop|increase|reduce)\b.{0,24}\b(?:dose|mg|mcg)\b|\b(?:you should|you must|you need to|next session|next workout)\b.{0,40}\b(?:lift|perform|do|use|add|try|increase|reduce)\b/i;
function object(value) { return value != null && typeof value === "object" && !Array.isArray(value); }
function keys(value, names) { return object(value) && Object.keys(value).length === names.length && names.every((name) => Object.hasOwn(value, name)); }
function number(value, min = 0, max = 100000) {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= min && parsed <= max ? Math.round(parsed * 100) / 100 : null;
}
function count(value, max = 100000) { const parsed = number(value, 0, max); return parsed != null && Number.isInteger(parsed) ? parsed : null; }
function instant(value) { return typeof value === "string" && value.length <= 40 ? sourceInstant(value) : null; }
function current(value, now, max = FRESH) { const time = value ? Date.parse(value) : NaN; return Number.isFinite(time) && time <= now + 300000 && now - time <= max; }
function day(now) { if (!Number.isFinite(now)) throw new Error("Invalid report time"); return new Date(now + 7 * 3600000).toISOString().slice(0, 10); }
function id(value) { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value) ? value : null; }
function title(value) {
  return typeof value === "string" && value.trim() && value.length <= 100 && /^[\p{L}\p{N} .()/'’&+\-]+$/u.test(value) && !UNSAFE.test(value) && !/\b(?:ignore|instruction|password|secret|token|api key)\b/i.test(value) ? value.trim() : "Exercise";
}
function stateOf(payload, now) {
  if (!object(payload)) return "missing";
  if (payload.sample || payload.demo || payload.is_sample || [payload.data_state, payload.dataState, payload.mode, payload.recap?.data_state].some((value) => ["sample", "demo"].includes(value))) return "sample";
  const explicit = payload.data_state ?? payload.dataState;
  if (STATES.includes(explicit) && explicit !== "live") return explicit;
  const generated = instant(payload.generated_at || payload.recap?.generated_at);
  if (!generated) return "missing";
  return current(generated, now) ? "live" : "stale";
}
function lastSource(dates, now) { return dates.filter((value) => value && Date.parse(value) <= now + 300000).sort().at(-1) || null; }
function equal(a, b) { return canonical(a) === canonical(b); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (object(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}
function unavailable(kind, state) {
  return kind === "training" ? { narrative: `A current training review is unavailable because the evidence is ${state}. Refresh the sources before interpreting the latest session.`, exercises: [] } : null;
}
function dailySnapshot(payload, now, state) {
  const progress = Array.isArray(payload?.exercise_progress) && payload.exercise_progress.length <= 200 ? payload.exercise_progress.map((item) => ({ exercise_template_id: item?.exercise_template_id, sessions: Array.isArray(item?.sessions) && item.sessions.length <= MAX_HISTORY ? item.sessions.filter((row) => current(sessionTime(row), now, 28 * DAY)) : [] })) : [];
  const recap = payload?.recap;
  const safe = buildBriefSnapshot({ generated_at: payload?.generated_at, recap: { generated_at: recap?.generated_at, summary: recap?.summary, freshness: recap?.freshness, evidence: { activity_daily: Array.isArray(recap?.evidence?.activity_daily) ? recap.evidence.activity_daily.slice(0, 366) : [] } }, exercise_progress: progress }, {}, state, now);
  safe.periodDays = 28;
  // A missing count is unknown, not a report of zero observations.
  const summary = payload?.recap?.summary;
  for (const [key, source] of [["sleep", summary?.sleep?.asleep_minutes], ["hrv", summary?.recovery?.hrv_ms], ["restingHeartRate", summary?.recovery?.resting_heart_rate_bpm], ["steps", summary?.activity?.steps]]) {
    if (source?.count == null) safe[key].count = null;
  }
  for (const [key, source] of [["workouts", summary?.training?.workouts], ["completedSets", summary?.training?.completed_sets]]) if (source == null) safe.training[key] = null;
  const effort = metrics({ working_sets: summary?.training?.working_sets ?? summary?.training?.completed_sets, average_rpe: summary?.training?.average_rpe, rpe_count: summary?.training?.rpe_count, rpe_coverage_percent: summary?.training?.rpe_coverage_percent }, 100000);
  safe.training.averageRpe = effort.averageRpe;
  safe.training.rpeCoverage = effort.rpeCoveragePercent;
  const { generatedAt: _generatedAt, ...evidence } = safe;
  return evidence;
}
function hydrateSnapshot(evidence, state, now) { return { ...evidence, dataState: state, generatedAt: new Date(now).toISOString() }; }
function usableDaily(snapshot, now) { return buildRulesBrief(snapshot, now).themes.slice(0, 5).some((theme) => theme.rating !== "insufficient"); }

function metrics(session, maxWorkingSets = MAX_SETS) {
  let workingSets = count(Object.hasOwn(session, "working_sets") ? session.working_sets : session.sets, maxWorkingSets);
  let loadKg = number(session.best_set?.weight_kg, 0, 2000);
  let reps = count(session.best_set?.reps, 1000);
  let averageRpe = number(session.average_rpe, 1, 10);
  let rpeCount = count(session.rpe_count, maxWorkingSets);
  let reportedCoverage = number(session.rpe_coverage_percent, 0, 100);
  // When explicit set evidence exists it is authoritative. Reduce immediately;
  // never expose set details (including user notes) to the assistant.
  if (Array.isArray(session.working_set_details)) {
    if (session.working_set_details.length > MAX_SETS) return null;
    const sets = session.working_set_details.filter((set) => object(set) && isWorkingSet(set));
    workingSets = sets.length;
    const rpes = sets.map((set) => number(set.rpe, 1, 10)).filter((value) => value != null);
    rpeCount = rpes.length;
    averageRpe = rpes.length ? number(rpes.reduce((a, b) => a + b, 0) / rpes.length, 1, 10) : null;
    reportedCoverage = workingSets ? Math.round(rpeCount / workingSets * 100) : 0;
    const best = sets.map((set) => ({ load: number(set.weight_kg, 0, 2000), reps: count(set.reps, 1000) }))
      .filter((set) => set.load != null && set.reps != null).sort((a, b) => b.load * (1 + b.reps / 30) - a.load * (1 + a.reps / 30) || b.load - a.load || b.reps - a.reps)[0];
    loadKg = best?.load ?? null; reps = best?.reps ?? null;
  } else if (session.best_set && !isWorkingSet(session.best_set)) { loadKg = null; reps = null; }
  if (!(workingSets > 0)) { loadKg = null; reps = null; }
  // An average without a valid logged-RPE count and denominator cannot establish
  // effort. A contradictory percentage invalidates the effort evidence too.
  const validCount = workingSets != null && rpeCount != null && rpeCount <= workingSets;
  const computed = validCount ? workingSets ? Math.round(rpeCount / workingSets * 100) : 0 : null;
  const consistent = computed != null && (reportedCoverage == null || Math.abs(reportedCoverage - computed) <= 0.51);
  if (!consistent) { averageRpe = null; rpeCount = null; }
  else if (rpeCount === 0 || !(workingSets > 0)) averageRpe = null;
  return { workingSets, loadKg, reps, averageRpe, rpeCount, rpeCoveragePercent: consistent ? computed : null };
}
function sessionTime(session) { return instant(session?.start_time || session?.start_time_bangkok || session?.date_bangkok || session?.date); }
function trainingEvidence(payload, now) {
  const sync = instant(payload?.recap?.freshness?.hevy?.synced_at);
  const recorded = instant(payload?.recap?.freshness?.hevy?.start_time);
  const evidence = { day: day(now), periodDays: 28, measuredAt: recorded, syncedAt: sync, latestAt: null, exercises: [] };
  if (!Array.isArray(payload?.recent_workouts) || payload.recent_workouts.length > 200 || !Array.isArray(payload?.exercise_progress) || payload.exercise_progress.length > 200) return evidence;
  const workouts = payload.recent_workouts.map((row) => ({ id: id(row?.id ?? row?.workout_id), at: sessionTime(row) })).filter((row) => row.id && row.at).sort((a, b) => b.at.localeCompare(a.at));
  const latest = workouts[0];
  if (!latest || workouts.some((row, index) => index && row.at === latest.at && row.id !== latest.id)) return evidence;
  evidence.latestAt = latest.at;
  const ids = payload.exercise_progress.map((row) => id(row?.exercise_template_id));
  for (const exercise of payload.exercise_progress) {
    const exerciseId = id(exercise?.exercise_template_id);
    if (!exerciseId || ids.filter((value) => value === exerciseId).length !== 1 || !Array.isArray(exercise.sessions) || exercise.sessions.length > MAX_HISTORY) continue;
    const sessions = exercise.sessions.filter((row) => row && id(row.exercise_template_id) === exerciseId && id(row.workout_id) && sessionTime(row));
    const currentRows = sessions.filter((row) => row.workout_id === latest.id);
    if (currentRows.length !== 1 || sessionTime(currentRows[0]) !== latest.at) continue;
    const currentMetrics = metrics(currentRows[0]);
    if (!currentMetrics || !(currentMetrics.workingSets > 0)) continue;
    const prior = sessions.filter((row) => row.workout_id !== latest.id && Date.parse(sessionTime(row)) < Date.parse(latest.at) && current(sessionTime(row), now, 28 * DAY)).sort((a, b) => sessionTime(b).localeCompare(sessionTime(a)));
    const previousRow = prior[0];
    const priorIsUnique = previousRow && prior.filter((row) => row.workout_id === previousRow.workout_id).length === 1;
    const previousMetrics = priorIsUnique ? metrics(previousRow) : null;
    const previous = previousMetrics?.workingSets > 0 ? { at: sessionTime(previousRow), ...previousMetrics } : null;
    evidence.exercises.push({ exerciseId, title: title(exercise.query || exercise.name || currentRows[0].title), current: { at: latest.at, ...currentMetrics }, previous });
  }
  evidence.exercises.sort((a, b) => a.exerciseId.localeCompare(b.exerciseId));
  // Never silently omit part of an oversized session and call it a whole review.
  if (evidence.exercises.length > MAX_EXERCISES) evidence.exercises = [];
  return evidence;
}
function shown(value, suffix = "") { return value == null ? "unavailable" : `${value}${suffix}`; }
function hasEffort(session) { return session && session.averageRpe != null && session.rpeCount > 0 && session.workingSets > 0 && session.rpeCoveragePercent >= 80; }
function describeSession(label, session) {
  return `${label}: ${shown(session.workingSets)} working sets; top set ${shown(session.loadKg, " kg")} × ${shown(session.reps, " reps")}; average RPE ${shown(session.averageRpe)}; RPE coverage ${shown(session.rpeCount)}/${shown(session.workingSets)} working sets (${shown(session.rpeCoveragePercent, "%")}).`;
}
function trainingDraft(evidence) {
  const exercises = evidence.exercises.map((item) => {
    const { current, previous } = item;
    const comparable = previous && [current.loadKg, current.reps, previous.loadKg, previous.reps].every((value) => value != null);
    let summary = previous ? "Load or rep evidence is incomplete; a performance comparison is unavailable." : "No earlier session with the same stable exercise ID is available in this window.";
    if (comparable) summary = current.loadKg !== previous.loadKg ? "The top-set load changed; reps and effort need context before comparing performance."
      : current.reps > previous.reps ? "The latest top set has more reps at the same recorded load."
      : current.reps < previous.reps ? "The latest top set has fewer reps at the same recorded load."
      : "The latest top set matches the previous recorded load and reps.";
    const effort = hasEffort(current) && hasEffort(previous);
    return { exerciseId: item.exerciseId, title: item.title, summary,
      evidence: [describeSession("Latest", current), ...(previous ? [describeSession("Previous", previous)] : [])],
      uncertainty: `${effort ? "Logged effort is available with adequate coverage in both sessions; technique and subjective readiness are not measured." : "Effort evidence is missing, partial, or insufficient for comparison; an absent RPE is not zero effort."} ${previous ? "Session differences are descriptive and do not establish overall progress or a future training target." : "No cross-session performance conclusion is supported."}` };
  });
  return { narrative: "The latest recorded session is reviewed below, using only earlier sessions with the same stable exercise ID. These comparisons describe logged performance and do not determine readiness or a future training target.", exercises };
}

export function buildReportInput(kind, payload, now = Date.now()) {
  if (!["daily", "training"].includes(kind)) throw new Error("Unknown report kind");
  day(now);
  let dataState = stateOf(payload, now);
  if (kind === "daily") {
    const snapshot = dailySnapshot(payload, now, dataState);
    if (dataState === "live" && !usableDaily(hydrateSnapshot(snapshot, "live", now), now)) dataState = "missing";
    snapshot.dataState = dataState;
    const evidence = { day: day(now), snapshot };
    return { version: REPORT_VERSION, kind, sourceAt: lastSource([...Object.values(snapshot.freshness), ...Object.values(snapshot.sourceSyncedAt)], now), dataState, evidence, draft: buildRulesBrief(hydrateSnapshot(snapshot, dataState, now), now) };
  }
  const evidence = trainingEvidence(payload, now);
  if (dataState === "live") {
    if (!evidence.syncedAt || !evidence.latestAt || !evidence.exercises.length) dataState = "missing";
    else if (!current(evidence.syncedAt, now) || !current(evidence.latestAt, now, 14 * DAY) || (evidence.measuredAt && !current(evidence.measuredAt, now, 14 * DAY))) dataState = "stale";
  }
  return { version: REPORT_VERSION, kind, sourceAt: lastSource([evidence.syncedAt, evidence.measuredAt, evidence.latestAt], now), dataState, evidence, draft: dataState === "live" ? trainingDraft(evidence) : unavailable(kind, dataState) };
}

// Stable recursive key ordering prevents property insertion order from invalidating
// reports. Bangkok day, source timestamps and all evidence are part of the key;
// request time, response generated_at and assistant prose are intentionally absent.
export async function buildReportHash(input) {
  if (!object(input) || input.version !== REPORT_VERSION || !["daily", "training"].includes(input.kind) || !STATES.includes(input.dataState) || !object(input.evidence)) throw new Error("Invalid report input");
  const bytes = new TextEncoder().encode(canonical({ version: input.version, kind: input.kind, sourceAt: input.sourceAt, dataState: input.dataState, evidence: input.evidence }));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function safeText(value, max) {
  // deno-lint-ignore no-control-regex
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/.test(value) && !UNSAFE.test(value);
}
function prose(value, expected, max) {
  if (!safeText(value, max) || /\b(?:consume|ingest|inject|medicate|administer|diagnostic|treatment)\b|^\s*(?:take|dose|treat)\b/i.test(value)) throw new Error("Unsafe report prose");
  // Exact rule prose may contain supported numbers. Rephrased prose keeps all
  // numerical claims in the immutable evidence, preventing number/unit swaps.
  if (value.trim() !== expected && (/\p{N}/u.test(value) || /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion|trillion|double|triple|twice|half|quarter)\b/i.test(value))) throw new Error("Numerical claims must remain in evidence");
  return value.trim();
}
function checkSession(value) {
  if (!keys(value, SESSION_KEYS) || instant(value.at) !== value.at) return false;
  const reconstructed = metrics({ working_sets: value.workingSets, best_set: { weight_kg: value.loadKg, reps: value.reps }, average_rpe: value.averageRpe, rpe_count: value.rpeCount, rpe_coverage_percent: value.rpeCoveragePercent });
  return reconstructed && equal(value, { at: value.at, ...reconstructed });
}
function expectedOutput(kind, input, now) {
  if (!keys(input, ["version", "kind", "sourceAt", "dataState", "evidence", "draft"]) || input.version !== REPORT_VERSION || input.kind !== kind || input.dataState !== "live" || input.evidence?.day !== day(now) || !input.sourceAt || instant(input.sourceAt) !== input.sourceAt) throw new Error("Report evidence is not current and live");
  if (kind === "daily") {
    if (!keys(input.evidence, ["day", "snapshot"]) || !keys(input.evidence.snapshot, SNAPSHOT_KEYS)) throw new Error("Invalid daily evidence");
    const snapshot = input.evidence.snapshot;
    if (!keys(snapshot.freshness, SIGNAL_KEYS) || !keys(snapshot.sourceSyncedAt, SIGNAL_KEYS) || snapshot.periodDays !== 28 || snapshot.dataState !== "live") throw new Error("Invalid daily evidence");
    const normalized = sanitizeBriefSnapshot(hydrateSnapshot(snapshot, "live", now), now);
    for (const key of ["sleep", "hrv", "restingHeartRate", "steps"]) if (snapshot[key]?.count === null) normalized[key].count = null;
    for (const key of ["workouts", "completedSets"]) if (snapshot.training?.[key] === null) normalized.training[key] = null;
    const { generatedAt: _generatedAt, ...safe } = normalized;
    if (input.sourceAt !== lastSource([...Object.values(snapshot.freshness), ...Object.values(snapshot.sourceSyncedAt)], now) || !equal(snapshot, safe) || !usableDaily(normalized, now)) throw new Error("Daily evidence is unavailable");
    return buildRulesBrief(normalized, now);
  }
  if (kind !== "training" || !keys(input.evidence, ["day", "periodDays", "measuredAt", "syncedAt", "latestAt", "exercises"])) throw new Error("Invalid training evidence");
  const evidence = input.evidence;
  if (input.sourceAt !== lastSource([evidence.syncedAt, evidence.measuredAt, evidence.latestAt], now) || evidence.periodDays !== 28 || !current(evidence.syncedAt, now) || !current(evidence.latestAt, now, 14 * DAY) || (evidence.measuredAt != null && !current(evidence.measuredAt, now, 14 * DAY)) || !Array.isArray(evidence.exercises) || !evidence.exercises.length || evidence.exercises.length > MAX_EXERCISES) throw new Error("Training evidence is unavailable");
  const seen = new Set();
  for (const exercise of evidence.exercises) {
    if (!keys(exercise, ["exerciseId", "title", "current", "previous"]) || !id(exercise.exerciseId) || seen.has(exercise.exerciseId) || title(exercise.title) !== exercise.title || !checkSession(exercise.current) || exercise.current.at !== evidence.latestAt || !(exercise.current.workingSets > 0)) throw new Error("Invalid exercise evidence");
    seen.add(exercise.exerciseId);
    if (exercise.previous && (!checkSession(exercise.previous) || !(exercise.previous.workingSets > 0) || Date.parse(exercise.previous.at) >= Date.parse(exercise.current.at) || !current(exercise.previous.at, now, 28 * DAY))) throw new Error("Invalid comparison evidence");
  }
  return trainingDraft(evidence);
}

export function validateReportOutput(kind, value, input, now = Date.now()) {
  const expected = expectedOutput(kind, input, now);
  if (kind === "daily") {
    const result = validateBriefResponse(value, hydrateSnapshot(input.evidence.snapshot, "live", now), now);
    result.narrative = prose(result.narrative, expected.narrative, 700);
    result.themes = result.themes.map((theme, index) => ({ ...theme, summary: prose(theme.summary, expected.themes[index].summary, 220) }));
    return result;
  }
  if (!keys(value, ["narrative", "exercises"]) || !Array.isArray(value.exercises) || value.exercises.length !== expected.exercises.length) throw new Error("Invalid training report");
  const narrative = prose(value.narrative, expected.narrative, 700);
  if (/\b(?:aim|target|recommend|try|lift|perform|do|use)\b.{0,35}\b(?:sets?|reps?|loads?|weights?|kg|intensity)\b/i.test(narrative)) throw new Error("Unsupported training prescription");
  const exercises = value.exercises.map((exercise, index) => {
    const rule = expected.exercises[index];
    if (!keys(exercise, ["exerciseId", "title", "summary", "evidence", "uncertainty"]) || exercise.exerciseId !== rule.exerciseId || exercise.title !== rule.title || !equal(exercise.evidence, rule.evidence) || exercise.uncertainty !== rule.uncertainty) throw new Error("Invalid training exercise");
    const summary = prose(exercise.summary, rule.summary, 300);
    if (/\b(?:aim|target|recommend|try|lift|perform|do|use)\b.{0,35}\b(?:sets?|reps?|loads?|weights?|kg|intensity)\b/i.test(summary)) throw new Error("Unsupported training prescription");
    const source = input.evidence.exercises[index];
    if ((!source.previous || [source.current.loadKg, source.current.reps, source.previous.loadKg, source.previous.reps].some((metric) => metric == null)) && summary !== rule.summary) throw new Error("Unsupported comparison claim");
    return { exerciseId: rule.exerciseId, title: rule.title, summary, evidence: [...rule.evidence], uncertainty: rule.uncertainty };
  });
  return { narrative, exercises };
}
