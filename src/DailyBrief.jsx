import React, { useMemo } from "react";
import { Icon } from "./icons";
import { buildBriefSnapshot, buildRulesBrief } from "./dailyBrief";
import { BriefThemeCards, BriefTimestamps, SavedBriefStatus, useSavedAssistantBrief } from "./SavedAssistantBrief";

export function DailyBriefContent({ payload, settings, dataState = "missing", assistantBrief = { status: "loading", report: null } }) {
  const snapshot = useMemo(() => buildBriefSnapshot(payload, settings, dataState), [payload, settings, dataState]);
  const fallback = useMemo(() => buildRulesBrief(snapshot), [snapshot]);
  // A sample payload is never mixed with a personal saved report.
  const current = snapshot.dataState === "sample" ? { status: "sample", report: null } : dataState === "stale" ? { status: "loading", report: null } : assistantBrief;
  const saved = current.status === "ready" && current.report;
  const brief = saved || fallback;
  const source = saved ? "Assistant summary" : snapshot.dataState === "live" ? "Rules-based" : "Brief unavailable";
  return <section className="daily-brief" aria-labelledby="daily-brief-title" aria-busy={current.status === "loading"}>
    <div className="section-title-row"><div><span className="section-kicker">Today at a glance</span><h2 id="daily-brief-title">Your daily health brief</h2></div><span className="brief-source">{source}</span></div>
    <div className="insight insight-blue daily-brief-narrative"><Icon name="sparkle" size={26} /><div><h3>How is your health looking today?</h3><p>{brief.narrative}</p></div></div>
    <SavedBriefStatus brief={current} fallback={!saved && snapshot.dataState === "live"} />
    <BriefTimestamps brief={current} />
    <BriefThemeCards themes={brief.themes} />
    <p className="coverage">Wellness context only, not a medical assessment. The brief uses aggregate measurements and does not include personal notes or pain reports.</p>
  </section>;
}

export function DailyBrief({ payload, settings, dataState = "missing", refreshKey = 0 }) {
  const sample = Boolean(payload?.sample || payload?.demo || payload?.is_sample || ["sample", "demo"].includes(payload?.data_state) || ["sample", "demo"].includes(payload?.mode) || dataState === "sample");
  const assistantBrief = useSavedAssistantBrief("daily", refreshKey, !sample && dataState === "live", sample ? "sample" : ["missing", "unavailable"].includes(dataState) ? "unavailable" : "loading");
  return <DailyBriefContent payload={payload} settings={settings} dataState={dataState} assistantBrief={assistantBrief} />;
}
