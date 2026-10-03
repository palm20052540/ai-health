import { sourceInstant } from "./dates.js";
// Shared browser/server contract. Only explicitly listed aggregate values may cross the model boundary.
export const BRIEF_VERSION = "health-brief-v1";
export const BRIEF_THEMES = [
  { id: "sleep", label: "Sleep" }, { id: "recovery", label: "Recovery" },
  { id: "training_readiness", label: "Training readiness" }, { id: "training_trend", label: "Training trend" },
  { id: "activity", label: "Activity" }, { id: "attention", label: "Attention" },
];
export const BRIEF_RATINGS = ["favorable", "steady", "caution", "insufficient"];
export const RATING_LABELS = { favorable: "Favorable", steady: "Steady", caution: "Take care", insufficient: "Not enough data" };
const DAY = 86400000;
const FRESH_MS = 48 * 60 * 60 * 1000;
const STATES = ["live", "loading", "stale", "missing", "sample"];

function finite(value, min = 0, max = 1e7) {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? Math.round(value * 100) / 100 : null;
}
function count(value, max = 100000) {
  return Number.isInteger(value) && value >= 0 && value <= max ? value : 0;
}
function timestamp(value) {
  if (typeof value !== "string" || value.length > 35 || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function stats(value, max) {
  const n = count(value?.count, 3660);
  return { count: n, latest: n ? finite(value?.latest, 0, max) : null, average: n ? finite(value?.average, 0, max) : null };
}
function current(value, now, age = FRESH_MS) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isFinite(time) && now - time <= age && time <= now + 5 * 60 * 1000;
}

export function sanitizeBriefSnapshot(input, now = Date.now()) {
  const value = input && typeof input === "object" ? input : {};
  const suppliedState = value.dataState === "demo" ? "sample" : value.dataState;
  let dataState = STATES.includes(suppliedState) ? suppliedState : "missing";
  const generatedAt = timestamp(value.generatedAt);
  if (dataState === "live" && !generatedAt) dataState = "missing";
  else if (dataState === "live" && !current(generatedAt, now)) dataState = "stale";
  const periodDays = count(value.periodDays, 365) || 30;
  const snapshot = {
    version: BRIEF_VERSION, dataState, generatedAt, periodDays,
    freshness: {
      sleep: timestamp(value.freshness?.sleep), hrv: timestamp(value.freshness?.hrv),
      restingHeartRate: timestamp(value.freshness?.restingHeartRate), steps: timestamp(value.freshness?.steps),
      training: timestamp(value.freshness?.training),
    },
    sourceSyncedAt: {
      sleep: timestamp(value.sourceSyncedAt?.sleep), hrv: timestamp(value.sourceSyncedAt?.hrv),
      restingHeartRate: timestamp(value.sourceSyncedAt?.restingHeartRate), steps: timestamp(value.sourceSyncedAt?.steps),
      training: timestamp(value.sourceSyncedAt?.training),
    },
    sleep: stats(value.sleep, 1440), hrv: stats(value.hrv, 1000),
    restingHeartRate: stats(value.restingHeartRate, 250), steps: stats(value.steps, 100000),
    training: {
      workouts: count(value.training?.workouts, 10000), completedSets: count(value.training?.completedSets),
      averageRpe: finite(value.training?.averageRpe, 1, 10), rpeCoverage: finite(value.training?.rpeCoverage, 0, 100),
      comparableExercises: count(value.training?.comparableExercises, 200),
      meanStrengthChangePercent: finite(value.training?.meanStrengthChangePercent, -100, 300),
    },
  };
  if (!snapshot.training.comparableExercises) snapshot.training.meanStrengthChangePercent = null;
  return snapshot;
}

// Reduce in-browser data to counts/averages only. Workout titles, IDs, health records,
// pain, personal context, photos, user-entered settings and all free text are excluded.
export function buildBriefSnapshot(payload, _settings, dataState = "missing", now = Date.now()) {
  const recap = payload?.recap || {};
  const summary = recap.summary || {};
  const freshness = recap.freshness || {};
  const health = freshness.google_health || {};
  const samplePayload = Boolean(payload?.sample || payload?.demo || payload?.is_sample || ["sample", "demo"].includes(payload?.data_state) || ["sample", "demo"].includes(payload?.mode));
  const seenTemplates = new Set();
  const changes = (Array.isArray(payload?.exercise_progress) ? payload.exercise_progress.slice(0, 200) : []).flatMap((exercise) => {
    const id = exercise.exercise_template_id;
    if (typeof id !== "string" || !id.trim() || seenTemplates.has(id)) return [];
    seenTemplates.add(id);
    const sessions = (Array.isArray(exercise.sessions) ? exercise.sessions : []).filter((session) =>
      session.exercise_template_id === id && typeof session.workout_id === "string" && session.workout_id.trim() && sourceInstant(session.start_time || session.start_time_bangkok || session.date || session.date_bangkok)
    ).slice().sort((a, b) => Date.parse(sourceInstant(a.start_time || a.start_time_bangkok || a.date || a.date_bangkok)) - Date.parse(sourceInstant(b.start_time || b.start_time_bangkok || b.date || b.date_bangkok)));
    if (sessions.length < 2 || sessions[0].workout_id === sessions.at(-1).workout_id) return [];
    const first = finite(sessions[0]?.best_estimated_1rm_kg, 0.1, 2000);
    const last = finite(sessions.at(-1)?.best_estimated_1rm_kg, 0.1, 2000);
    const change = first && last ? ((last - first) / first) * 100 : null;
    return change != null && change >= -100 && change <= 300 ? [change] : [];
  });
  const completeActivityDates = (Array.isArray(recap.evidence?.activity_daily) ? recap.evidence.activity_daily : []).flatMap((row) => {
    if (finite(row.steps, 0, 100000) == null || typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return [];
    const date = timestamp(`${row.date}T23:59:59+07:00`);
    return date ? [date] : [];
  }).sort();
  return sanitizeBriefSnapshot({
    dataState: samplePayload ? "sample" : typeof dataState === "object" ? dataState?.status : dataState,
    generatedAt: payload?.generated_at || recap.generated_at,
    periodDays: recap.period?.days || payload?.period?.days,
    freshness: {
      sleep: health.sleep?.recorded_at, hrv: health["daily-heart-rate-variability"]?.recorded_at,
      restingHeartRate: health["daily-resting-heart-rate"]?.recorded_at,
      // The newest source steps may be a partial day. Only dated complete-day evidence supports the aggregate's freshness.
      steps: completeActivityDates.at(-1), training: freshness.hevy?.start_time,
    },
    sourceSyncedAt: {
      sleep: health.sleep?.synced_at, hrv: health["daily-heart-rate-variability"]?.synced_at,
      restingHeartRate: health["daily-resting-heart-rate"]?.synced_at,
      steps: health.steps?.synced_at, training: freshness.hevy?.synced_at,
    },
    sleep: summary.sleep?.asleep_minutes, hrv: summary.recovery?.hrv_ms,
    restingHeartRate: summary.recovery?.resting_heart_rate_bpm, steps: summary.activity?.steps,
    training: {
      workouts: summary.training?.workouts, completedSets: summary.training?.completed_sets,
      averageRpe: summary.training?.average_rpe, rpeCoverage: summary.training?.rpe_coverage_percent,
      comparableExercises: changes.length,
      meanStrengthChangePercent: changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : null,
    },
  }, now);
}

function display(value, suffix = "") { return `${Math.round(value * 10) / 10}${suffix}`; }
function unknown(id, reason) {
  return { id, rating: "insufficient", summary: "A reliable rating is not available yet.", evidence: [reason], uncertainty: "Missing or outdated evidence cannot describe today's condition." };
}
function metricReady(snapshot, key, now, minCount = 1) {
  return snapshot[key].count >= minCount && snapshot[key].latest != null && current(snapshot.freshness[key], now) && current(snapshot.sourceSyncedAt[key], now);
}

export function buildRulesBrief(input, now = Date.now()) {
  const snapshot = sanitizeBriefSnapshot(input, now);
  if (snapshot.dataState !== "live") {
    const reasons = {
      sample: "Sample data is a layout preview, not your health evidence.", loading: "Current evidence is still loading.",
      stale: "The snapshot is outdated; refresh before interpreting today's health.", missing: "Current, dated health evidence is unavailable.",
    };
    const reason = reasons[snapshot.dataState];
    return { narrative: `Today's health picture is not available. ${reason} All six ratings are withheld until current evidence is available.`, themes: BRIEF_THEMES.map(({ id }) => unknown(id, reason)) };
  }
  const sleep = snapshot.sleep, hrv = snapshot.hrv, hr = snapshot.restingHeartRate, steps = snapshot.steps, training = snapshot.training;
  let sleepTheme = unknown("sleep", "A current sleep measurement with a recent source sync is not available.");
  if (metricReady(snapshot, "sleep", now)) {
    const baseline = sleep.count >= 7 && sleep.average > 0;
    const difference = baseline ? sleep.latest - sleep.average : null;
    sleepTheme = {
      id: "sleep", rating: !baseline ? "insufficient" : difference < -60 ? "caution" : "steady",
      summary: !baseline ? "Sleep is recorded; your comparison window is still building." : difference < -60 ? "Your latest sleep was shorter than your recorded average." : "Your latest sleep duration is near or above your recorded average.",
      evidence: [`Latest sleep: ${display(sleep.latest)} min; average: ${sleep.average == null ? "unavailable" : display(sleep.average)} min across ${sleep.count} nights.`],
      uncertainty: "Duration alone does not establish sleep quality; this comparison window is not a clinical target.",
    };
  }
  const recoveryReady = metricReady(snapshot, "hrv", now, 7) && metricReady(snapshot, "restingHeartRate", now, 7) && hrv.average > 0 && hr.average > 0;
  let recovery = unknown("recovery", "Current, recently synced HRV and resting-heart-rate readings plus at least 7 readings of each are needed.");
  if (recoveryReady) {
    const caution = hrv.latest < hrv.average * 0.85 || hr.latest > hr.average * 1.1;
    recovery = {
      id: "recovery", rating: caution ? "caution" : "steady",
      summary: caution ? "One recovery signal differs noticeably from your recorded average." : "Recorded recovery signals are broadly near your averages.",
      evidence: [`HRV: ${display(hrv.latest)} ms vs ${display(hrv.average)} ms average (${hrv.count} readings).`, `Resting heart rate: ${display(hr.latest)} bpm vs ${display(hr.average)} bpm average (${hr.count} readings).`],
      uncertainty: "Wearable changes have many causes and do not establish overall recovery or a medical condition.",
    };
  }
  const readinessReady = recoveryReady && sleepTheme.rating !== "insufficient";
  const readiness = readinessReady ? {
    id: "training_readiness", rating: sleepTheme.rating === "caution" || recovery.rating === "caution" ? "caution" : "steady",
    summary: sleepTheme.rating === "caution" || recovery.rating === "caution" ? "Favor an easy start and reassess how you feel." : "Use your usual plan as a starting point and reassess during warm-up.",
    evidence: [`Sleep rating: ${sleepTheme.rating}; recovery rating: ${recovery.rating}.`],
    uncertainty: "This heuristic is not a validated readiness score. It cannot clear you for exercise or justify increasing intensity; subjective readiness is not measured.",
  } : unknown("training_readiness", "Readiness needs current sleep and recovery evidence with enough comparison readings.");
  let trend = unknown("training_trend", "At least two template-matched sessions from distinct workouts and recently synced training evidence are needed.");
  if (training.workouts >= 2 && training.comparableExercises > 0 && training.meanStrengthChangePercent != null && current(snapshot.freshness.training, now, 14 * DAY) && current(snapshot.sourceSyncedAt.training, now)) {
    const change = training.meanStrengthChangePercent;
    trend = {
      id: "training_trend", rating: change < -5 ? "caution" : change > 2 ? "favorable" : "steady",
      summary: change > 2 ? "Recorded strength estimates are trending upward." : change < -5 ? "Recorded strength estimates are below their first comparison." : "Recorded strength estimates are broadly steady.",
      evidence: [`Mean first-to-last estimated 1RM change: ${display(change)}% across ${training.comparableExercises} comparable exercises in ${snapshot.periodDays} days.`, `${training.workouts} workouts and ${training.completedSets} completed sets recorded.`],
      uncertainty: "Different session spacing, technique and effort can change estimated strength; this does not prescribe a load increase.",
    };
  }
  let activity = unknown("activity", "Dated, recently synced step evidence with at least 7 complete days is needed.");
  if (metricReady(snapshot, "steps", now, 7) && steps.average > 0) {
    activity = {
      id: "activity", rating: steps.latest < steps.average * 0.7 ? "caution" : "steady",
      summary: steps.latest < steps.average * 0.7 ? "The latest complete day was less active than your recorded average." : "The latest complete day was near or above your recorded activity average.",
      evidence: [`Latest complete day: ${display(steps.latest)} steps; average: ${display(steps.average)} across ${steps.count} days.`],
      uncertainty: "A completed-day total is not today's live progress, and steps do not measure all activity.",
    };
  }
  const primary = [sleepTheme, recovery, readiness, trend, activity];
  const missing = primary.filter((item) => item.rating === "insufficient").length;
  const cautious = primary.filter((item) => item.rating === "caution").length;
  const attention = {
    id: "attention", rating: cautious ? "caution" : missing ? "insufficient" : "steady",
    summary: cautious ? "Review the flagged signals before changing your plan." : missing ? "Fill the evidence gaps before drawing stronger conclusions." : "Keep watching the pattern rather than any single reading.",
    evidence: [`${cautious} of 5 signal themes flagged for care; ${missing} have insufficient evidence.`],
    uncertainty: "Absence of a flag does not establish good health; this brief is limited to the signals above.",
  };
  return {
    narrative: missing === 5 ? "Today's health picture cannot be rated from the available evidence. Refresh your sources and build dated comparison readings before changing your plan."
      : `${cautious ? "Today's recorded signals call for a cautious approach." : "Today's available signals are broadly steady within the recorded comparison window."} ${missing ? `${missing} of 5 signal themes still need better evidence. ` : ""}${sleepTheme.rating === "caution" ? "Shorter recorded sleep is worth prioritizing. " : ""}Use the patterns below as context and check how you feel before training.`,
    themes: [...primary, attention],
  };
}

const UNSAFE_COPY = /\b(?:diagnos\w*|prescrib\w*|testosterone|steroid\w*|hormone\w*|medication\w*|drug\w*|dosage|supplement\w*|cure[ds]?|disease|diabetes|cancer|arrhythmia|hypertension|overtraining syndrome)\b|\b(?:increase|double|reduce|stop|start)\b.{0,24}\b(?:dose|mg|mcg)\b|\b(?:guaranteed|certainly healthy|safe to exercise|cleared for exercise)\b|https?:\/\/|<[^>]*>/i;
function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function safeText(value, max) {
  // Reject invisible control characters in model output intentionally.
  // deno-lint-ignore no-control-regex
  return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000B-\u001F]/.test(value) && !UNSAFE_COPY.test(value);
}

// Semantic safeguards are deliberately conservative: model ratings, cited evidence
// and uncertainty must exactly match the deterministic evidence engine.
export function validateBriefResponse(value, input, now = Date.now()) {
  const expected = buildRulesBrief(input, now);
  if (!exactKeys(value, ["narrative", "themes"]) || !safeText(value.narrative, 700) || !Array.isArray(value.themes) || value.themes.length !== 6) throw new Error("Invalid brief structure");
  const themes = value.themes.map((theme, index) => {
    const rule = expected.themes[index];
    if (!exactKeys(theme, ["id", "rating", "summary", "evidence", "uncertainty"]) || theme.id !== rule.id || !BRIEF_RATINGS.includes(theme.rating) || theme.rating !== rule.rating || !safeText(theme.summary, 220) || !Array.isArray(theme.evidence) || JSON.stringify(theme.evidence) !== JSON.stringify(rule.evidence) || theme.uncertainty !== rule.uncertainty) throw new Error("Invalid brief theme");
    if (rule.rating === "insufficient" && theme.summary !== rule.summary) throw new Error("Unsupported insufficient-evidence claim");
    return { id: theme.id, rating: theme.rating, summary: theme.summary, evidence: [...rule.evidence], uncertainty: rule.uncertainty };
  });
  const knownNumbers = new Set(JSON.stringify(expected).match(/\d+(?:\.\d+)?/g) || []);
  for (const number of `${value.narrative} ${themes.map((item) => item.summary).join(" ")}`.match(/\d+(?:\.\d+)?/g) || []) if (!knownNumbers.has(number)) throw new Error("Unsupported numeric claim");
  return { narrative: value.narrative.trim(), themes };
}

export async function fetchDailyBrief(snapshot, signal, fetchImpl = fetch) {
  const safeSnapshot = sanitizeBriefSnapshot(snapshot);
  const response = await fetchImpl("/api/health-brief", { method: "POST", headers: { "Content-Type": "application/json" }, signal, body: JSON.stringify({ snapshot: safeSnapshot }) });
  const result = await response.json();
  if (!response.ok || !["model", "rules", "unavailable"].includes(result?.mode) || typeof result.configured !== "boolean") throw new Error("Health brief unavailable");
  if (result.mode === "model" && (safeSnapshot.dataState !== "live" || result.configured !== true)) throw new Error("Unsupported model brief");
  return { ...result, brief: result.mode === "model" ? validateBriefResponse(result.brief, safeSnapshot) : buildRulesBrief(safeSnapshot) };
}
