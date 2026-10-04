import { sourceInstant } from "./dates.js";
import { finiteNumber as number } from "./recoveryModel.js";

function formatNumber(value, digits = 0) {
  const parsed = number(value);
  return parsed == null ? "—" : new Intl.NumberFormat("en", { maximumFractionDigits: digits }).format(parsed);
}

function formatMinutes(value) {
  const minutes = number(value);
  if (minutes == null) return "—";
  return `${Math.floor(minutes / 60)}h ${Math.round(minutes % 60)}m`;
}

function percentFromAverage(latest, average) {
  const current = number(latest), baseline = number(average);
  if (current == null || !baseline) return "no baseline";
  const change = Math.round(((current - baseline) / baseline) * 100);
  return `${change >= 0 ? "+" : ""}${change}% vs avg`;
}

function sampleRows(rows, max = 7) {
  if (!rows?.length) return [];
  if (rows.length <= max) return rows;
  return Array.from({ length: max }, (_, index) => rows[Math.round((index / (max - 1)) * (rows.length - 1))]);
}

function chart(rows, key, fallback = 0) {
  const sampled = sampleRows(rows.filter((row) => number(row[key]) != null));
  const values = sampled.map((row) => number(row[key]) ?? fallback);
  return values.length === 1 ? [values[0], values[0]] : values;
}

function dateLabel(value) {
  if (!value) return "";
  const instant = sourceInstant(value);
  if (!instant) return "—";
  const date = new Date(instant);
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", month: "short", day: "numeric" }).format(date);
}

function labels(rows) {
  const result = sampleRows(rows).map((row) => dateLabel(row.date));
  return result.length === 1 ? [result[0], result[0]] : result;
}

function latestFreshness(payload) {
  const freshness = payload?.recap?.freshness;
  const candidates = [freshness?.hevy?.synced_at, ...Object.values(freshness?.google_health || {}).map((item) => item?.synced_at)].filter(Boolean);
  return candidates.sort().at(-1) || payload?.generated_at;
}

export function buildLiveView(payload, settings) {
  const recap = payload?.recap || {};
  const summary = recap.summary || {};
  const recovery = summary.recovery || {};
  const activity = summary.activity || {};
  const sleep = summary.sleep || {};
  const training = summary.training || {};
  const evidence = recap.evidence || {};
  const activityRows = evidence.activity_daily || [];
  const recoveryRows = evidence.recovery_daily || [];
  const hrvRows = recoveryRows.filter((row) => row.type === "daily-heart-rate-variability" && number(row.value) != null);
  const restingRows = recoveryRows.filter((row) => row.type === "daily-resting-heart-rate" && number(row.value) != null);
  const weights = payload.body_measurements || [];
  const latestWeight = weights[0]?.weight_kg;

  const healthChartRows = sampleRows(activityRows);
  const recoveryChartRows = sampleRows(hrvRows);
  const exerciseRows = (payload.exercise_progress || []).map((exercise) => {
    const sessions = exercise.sessions || [];
    const values = sessions.map((session) => number(session.best_estimated_1rm_kg)).filter((value) => value != null);
    const first = values[0], last = values.at(-1);
    const delta = first && last ? ((last - first) / first) * 100 : null;
    return {
      name: exercise.query || sessions[0]?.title || "Exercise",
      exercise_template_id: exercise.exercise_template_id || null,
      id: exercise.exercise_template_id || null,
      muscleGroup: exercise.muscle_group || null,
      metric: "Estimated 1RM",
      result: delta == null ? "Building" : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
      detail: `${sessions.length} sessions`,
      values: values.length > 1 ? sampleRows(values.map((value) => ({ value }))).map((item) => item.value) : [last || 0, last || 0],
      sessions,
    };
  });

  const leadExercise = exerciseRows[0];
  const leadSessions = leadExercise?.sessions || [];
  const latestSession = leadSessions.at(-1);
  const currentLoad = number(latestSession?.best_set?.weight_kg);
  const targetRpe = number(settings?.training?.targetRpe) ?? 8;
  // Legacy details can show a held load only. Routine-specific planning owns all progression.
  const recommendation = {
    exercise: leadExercise?.name || "Next exercise", exercise_template_id: leadExercise?.exercise_template_id,
    load: currentLoad, currentLoad, targetRpe, reps: latestSession?.best_set?.reps ?? "—",
    explanation: "Choose a real routine in Next Session Plan and submit today’s Recovery check-in before considering progression.",
  };

  const hrvLatest = recovery.hrv_ms?.latest;
  const hrvAverage = recovery.hrv_ms?.average;
  const sleepAverage = sleep.asleep_minutes?.average;
  const trainingLead = leadExercise?.result || "building history";

  return {
    lastSynced: latestFreshness(payload),
    coverage: recap.coverage || {},
    insights: {
      Health: {
        title: `${recap.coverage?.activity_complete_days || 0} complete days are shaping your current health baseline.`,
        copy: `Steps average ${formatNumber(activity.steps?.average)} per day while resting heart rate is ${formatNumber(recovery.resting_heart_rate_bpm?.latest)} bpm.`
      },
      Recovery: {
        title: hrvLatest == null ? "Recovery data is still building." : `HRV is ${percentFromAverage(hrvLatest, hrvAverage)}.`,
        copy: `Average sleep is ${formatMinutes(sleepAverage)}. Use the trend with training effort rather than any single reading.`
      },
      Training: {
        title: leadExercise ? `${leadExercise.name} is ${trainingLead} across this range.` : "Training history is ready for the next completed workout.",
        copy: `${formatNumber(training.completed_sets)} sets across ${formatNumber(training.workouts)} sessions, with ${formatNumber(training.rpe_coverage_percent)}% RPE coverage.`
      },
    },
    health: {
      evidence: [
        { label: "Steps", value: formatNumber(activity.steps?.average), delta: percentFromAverage(activity.steps?.latest, activity.steps?.average) },
        { label: "Resting HR", value: recovery.resting_heart_rate_bpm?.latest == null ? "—" : `${formatNumber(recovery.resting_heart_rate_bpm.latest, 1)} bpm`, delta: "latest", metric: "Resting heart rate" },
        { label: "Weight", value: latestWeight == null ? "—" : `${formatNumber(latestWeight, 1)} kg`, delta: weights.length > 1 ? `${formatNumber(latestWeight - weights.at(-1).weight_kg, 1)} kg` : "latest" },
      ],
      chart: {
        title: "Health trends",
        labels: labels(healthChartRows),
        series: [
          { name: "Steps (k)", color: "#146BFA", values: chart(healthChartRows, "steps").map((value) => value / 1000) },
          { name: "Resting HR", color: "#76AEFF", values: chart(restingRows.map((row) => ({ ...row, resting: row.value })), "resting") },
        ],
      },
      metrics: [
        { icon: "moon", label: "Sleep", meta: "Nightly average", value: formatMinutes(sleepAverage), delta: `${sleep.asleep_minutes?.count || 0} nights`, tone: "blue" },
        { icon: "shoe", label: "Steps", meta: "Daily average", value: formatNumber(activity.steps?.average), delta: `${activity.steps?.count || 0} days`, tone: "blue" },
        { icon: "heart", label: "Resting heart rate", meta: "Latest", value: recovery.resting_heart_rate_bpm?.latest == null ? "—" : `${formatNumber(recovery.resting_heart_rate_bpm.latest, 1)} bpm`, delta: "personal", tone: "red" },
        { icon: "scale", label: "Weight", meta: "Latest Hevy measurement", value: latestWeight == null ? "—" : `${formatNumber(latestWeight, 1)} kg`, delta: `${weights.length} entries`, tone: "blue" },
        { icon: "flame", label: "Active zone minutes", meta: "Daily average", value: activity.active_zone_minutes?.average == null ? "—" : `${formatNumber(activity.active_zone_minutes.average)} min`, delta: `${activity.active_zone_minutes?.count || 0} days`, tone: "orange" },
      ],
      weightValues: weights.slice().reverse().map((item) => number(item.weight_kg)).filter((value) => value != null),
    },
    recovery: {
      evidence: [
        { label: "HRV", value: hrvLatest == null ? "—" : `${formatNumber(hrvLatest, 1)} ms`, delta: percentFromAverage(hrvLatest, hrvAverage), metric: "HRV" },
        { label: "Sleep", value: formatMinutes(sleep.asleep_minutes?.latest), delta: `${sleep.asleep_minutes?.count || 0} nights` },
        { label: "Resting HR", value: recovery.resting_heart_rate_bpm?.latest == null ? "—" : `${formatNumber(recovery.resting_heart_rate_bpm.latest, 1)} bpm`, delta: "latest", metric: "HRV" },
      ],
      chart: {
        title: "Recovery signals",
        labels: labels(recoveryChartRows),
        series: [
          { name: "HRV (ms)", color: "#146BFA", values: chart(hrvRows.map((row) => ({ ...row, hrv: row.value })), "hrv") },
          { name: "Resting HR", color: "#76AEFF", values: chart(restingRows.map((row) => ({ ...row, resting: row.value })), "resting") },
        ],
      },
      drivers: [
        { icon: "moon", title: "Sleep consistency", detail: `${sleep.asleep_minutes?.count || 0} nights available; average ${formatMinutes(sleepAverage)}.` },
        { icon: "pulse", title: "HRV baseline", detail: `${recovery.hrv_ms?.count || 0} readings; latest is ${percentFromAverage(hrvLatest, hrvAverage)}.` },
        { icon: "dumbbell", title: "Recent training load", detail: `${formatNumber(training.completed_sets)} sets in ${formatNumber(training.workouts)} sessions.` },
      ],
    },
    training: {
      evidence: [
        { label: "Sessions", value: formatNumber(training.workouts), delta: "selected range" },
        { label: "Hard sets", value: formatNumber((training.muscle_groups || []).reduce((sum, item) => sum + Number(item.hard_sets || 0), 0)), delta: `${formatNumber(training.rpe_coverage_percent)}% RPE coverage`, metric: "Hard sets" },
        { label: "Avg RPE", value: formatNumber(training.average_rpe, 1), delta: number(training.average_rpe) == null ? "not logged" : training.average_rpe > 8.5 ? "elevated" : "logged", tone: "orange" },
      ],
      exercises: exerciseRows,
      muscles: training.muscle_groups || [],
      recommendation,
      recentWorkout: payload.recent_workouts?.[0] || null,
      recentWorkouts: payload.recent_workouts || [],
    },
  };
}
