import { finiteNumber } from "./analytics.ts";

type Row = Record<string, unknown>;
const TYPES = ["sleep", "daily-heart-rate-variability", "daily-resting-heart-rate"];
const DAY = 86400000;
function time(value: unknown): string | null {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}
function day(at: string | number) { return new Date(new Date(at).getTime() + 7 * 3600000).toISOString().slice(0, 10); }
function number(value: unknown, max: number) { const n = finiteNumber(value); return n != null && n >= 0 && n <= max ? n : null; }
export function buildChatRecoveryEvidence(raw: Row | null, now = Date.now()) {
  if (!raw || raw.truncated || !Array.isArray(raw.records) || raw.records.length > 300) return { dataState: "unavailable", reason: "Recovery evidence is missing or exceeds the bounded source limit." };
  const groups = TYPES.map((type) => {
    const rows = (raw.records as Row[]).filter((row) => row.data_type === type && time(row.recorded_at) && Date.parse(String(row.recorded_at)) <= now + 60000 && now - Date.parse(String(row.recorded_at)) <= 28 * DAY).map((row) => {
      const interval = row.interval && typeof row.interval === "object" ? row.interval as Row : {};
      const stages = Array.isArray(row.stages) ? row.stages : [];
      return {
        measuredAt: time(row.recorded_at), syncedAt: time(row.synced_at), value: number(row.value, type === "sleep" ? 1440 : type === "daily-resting-heart-rate" ? 300 : 1000),
        ...(type === "sleep" ? { sleepStart: time(interval.startTime ?? interval.start_time), sleepEnd: time(interval.endTime ?? interval.end_time),
          stages: stages.filter((stage) => stage && ["LIGHT", "DEEP", "REM", "AWAKE"].includes(stage.type)).map((stage) => ({ type: stage.type, minutes: number(stage.minutes, 1440) })) } : {}),
      };
    }).sort((a,b) => String(a.measuredAt).localeCompare(String(b.measuredAt)));
    const latest = rows.at(-1) || null;
    const baselineRows = rows.slice(0,-1).filter((row) => row.value != null);
    const uniqueDays = new Set(baselineRows.map((row) => day(row.measuredAt!)));
    const baseline = uniqueDays.size === baselineRows.length && baselineRows.length >= 3 ? baselineRows.reduce((sum,row)=>sum+row.value!,0)/baselineRows.length : null;
    const current = latest?.value != null && latest.measuredAt && latest.syncedAt && now-Date.parse(latest.measuredAt)<=2*DAY && now-Date.parse(latest.syncedAt)<=2*DAY && Date.parse(latest.syncedAt)<=now+60000;
    return { type, unit: type === "sleep" ? "minutes" : type === "daily-heart-rate-variability" ? "ms" : "bpm", status: current ? "current" : latest ? "stale_or_missing" : "missing", latest,
      baseline: { average: baseline, readings: baselineRows.length, distinctDays: uniqueDays.size, excludesLatest: true }, records: rows };
  });
  const sleep = groups[0].latest;
  return { version: "chat-recovery-v1", dataState: groups.every((group)=>group.status==='current') ? 'live' : 'partial', generatedAt:new Date(now).toISOString(), timezone:"Asia/Bangkok", baselineDays:28,
    sleepEndedToday: sleep && 'sleepEnd' in sleep && sleep.sleepEnd ? day(sleep.sleepEnd)===day(now) : null,
    signals:groups, currentCheckInIncluded:false, medicalClearance:false,
    interpretation:"Describe measured sleep and personal trends. Ask for current pain and fatigue before a training decision; missing data is not a normal reading." };
}
