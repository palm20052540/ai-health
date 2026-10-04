import { sourceInstant } from "./dates.js";
import { finiteNumber } from "./recoveryModel.js";
import { daysForRange, isSamplePayload } from "./portalData.js";

export const HEALTH_HISTORY = {
  HRV: { source: "Google Health", type: "daily-heart-rate-variability", unit: "ms" },
  Sleep: { source: "Google Health", type: "sleep", unit: "min" },
  Steps: { source: "Google Health", field: "steps", unit: "steps" },
  "Resting heart rate": { source: "Google Health", type: "daily-resting-heart-rate", unit: "bpm" },
  Weight: { source: "Hevy", field: "weight_kg", unit: "kg" },
  "Active zone minutes": { source: "Google Health", field: "active_zone_minutes", unit: "min" },
};

export function historyMetric(label) {
  const aliases = { "Resting HR": "Resting heart rate", "Sleep consistency": "Sleep", "HRV baseline": "HRV" };
  const name = aliases[label] || label;
  return Object.hasOwn(HEALTH_HISTORY, name) ? name : null;
}

const day = (stamp) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(stamp));
export function historyDate(value) {
  const instant = sourceInstant(value);
  if (!instant) return "Date unavailable";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  return new Intl.DateTimeFormat("en", { timeZone: "Asia/Bangkok", day: "numeric", month: "short", year: "numeric", ...(dateOnly ? {} : { hour: "numeric", minute: "2-digit" }) }).format(new Date(instant));
}

export function historyValue(value, metric) {
  const parsed = finiteNumber(value);
  if (parsed == null || parsed < 0) return "Unavailable";
  if (metric === "Sleep") {
    const minutes = Math.round(parsed);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  }
  const unit = HEALTH_HISTORY[metric]?.unit || "";
  return `${new Intl.NumberFormat("en", { maximumFractionDigits: metric === "Weight" || metric === "Resting heart rate" || metric === "HRV" ? 1 : 0 }).format(parsed)} ${unit}`.trim();
}

export function buildMetricHistory(payload, metric, range = "30D", dataState = "live") {
  const config = HEALTH_HISTORY[metric];
  const result = { metric, source: config?.source || "Source", rows: [], available: 0, missing: 0, excluded: 0, days: daysForRange(range), status: dataState, snapshotAt: payload?.generated_at || null };
  if (!config || !payload || isSamplePayload(payload) || ["sample", "missing", "loading", "unavailable"].includes(dataState)) return { ...result, status: isSamplePayload(payload) ? "sample" : ["sample", "missing", "loading", "unavailable"].includes(dataState) ? dataState : "missing" };
  const evidence = payload.recap?.evidence || {};
  let rows;
  if (metric === "Weight") {
    rows = (Array.isArray(payload.body_measurements) ? payload.body_measurements : []).map((row) => ({ date: row.measurement_date, value: row.weight_kg, note: "Recorded measurement" }));
    // This endpoint returns the last N measurements, not a date-filtered series.
    // Never imply that this bounded cache is a complete archive.
    const end = Date.parse(payload.generated_at || "");
    if (!Number.isFinite(end)) return { ...result, status: "unavailable" };
    const fromDay = day(end - result.days * 86400000), untilDay = day(end);
    rows = rows.filter((row) => {
      const instant = sourceInstant(row.date);
      if (!instant) return true;
      const included = day(instant) >= fromDay && day(instant) <= untilDay;
      if (!included) result.excluded++;
      return included;
    });
  } else if (config.type) {
    rows = (Array.isArray(evidence.recovery_daily) ? evidence.recovery_daily : []).filter((row) => row.type === config.type).map((row) => ({ date: row.date, value: row.value, note: metric === "Sleep" ? "Logged sleep record" : metric === "HRV" ? "Daily HRV measurement" : "Daily resting measurement" }));
  } else {
    rows = (Array.isArray(evidence.activity_daily) ? evidence.activity_daily : []).map((row) => ({ date: row.date, value: row[config.field], note: "Completed calendar day" }));
    const partial = payload.recap?.summary?.activity?.partial_day;
    if (partial && partial.is_complete_day === false) rows.push({ date: partial.activity_date, value: partial[config.field], note: "Partial day · excluded from average" });
  }
  result.rows = rows.map((row, index) => {
    const instant = sourceInstant(row.date), value = finiteNumber(row.value);
    const available = value != null && value >= 0;
    return { ...row, id: `${instant || "undated"}-${index}`, instant, available, displayValue: historyValue(row.value, metric), displayDate: historyDate(row.date), note: instant ? row.note : "Date unavailable · period cannot be verified" };
  }).sort((a, b) => (b.instant ? Date.parse(b.instant) : -Infinity) - (a.instant ? Date.parse(a.instant) : -Infinity));
  result.available = result.rows.filter((row) => row.available).length;
  result.missing = result.rows.length - result.available;
  return result;
}
