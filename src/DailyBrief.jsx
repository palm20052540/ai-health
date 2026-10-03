import React, { useEffect, useMemo, useState } from "react";
import { Icon } from "./icons";
import { BRIEF_THEMES, RATING_LABELS, buildBriefSnapshot, buildRulesBrief, fetchDailyBrief } from "./dailyBrief";

const REASONS = {
  authorization_not_configured: "OpenAI is configured, but access protection is not configured. The model was not called.",
  model_not_configured: "OpenAI is not configured; this is a rules-based summary.",
  model_timeout: "OpenAI timed out; the rules-based summary is shown.",
  model_unavailable: "OpenAI is unavailable; the rules-based summary is shown.",
  model_busy: "OpenAI is busy; the rules-based summary is shown.",
  insufficient_evidence: "There is not enough current evidence for an AI brief.",
  data_sample: "Sample preview. These are not personal health conclusions.",
  data_missing: "Current health evidence is unavailable.",
  data_loading: "Waiting for current health evidence.",
  data_stale: "The evidence is outdated. Refresh before interpreting today's health.",
};

export function DailyBrief({ payload, settings, dataState = "missing" }) {
  const snapshot = useMemo(() => buildBriefSnapshot(payload, settings, dataState), [payload, settings, dataState]);
  const snapshotKey = JSON.stringify(snapshot);
  const fallback = useMemo(() => buildRulesBrief(snapshot), [snapshot]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    // A client deadline also handles a stalled same-origin connection.
    const timer = setTimeout(() => controller.abort(), 12000);
    fetchDailyBrief(JSON.parse(snapshotKey), controller.signal).then((response) => {
      if (active) setResult({ key: snapshotKey, ...response });
    }).catch(() => {
      if (active) setResult({ key: snapshotKey, configured: null, mode: snapshot.dataState === "live" ? "rules" : "unavailable", reason: "request_unavailable", brief: fallback });
    }).finally(() => { clearTimeout(timer); if (active) setLoading(false); });
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [snapshotKey]);
  // A previous input's answer is never displayed while its replacement is loading.
  const current = result?.key === snapshotKey ? result : null;
  const brief = current?.brief || fallback;
  const mode = current?.mode || (snapshot.dataState === "live" ? "rules" : "unavailable");
  const source = mode === "model" ? "AI generated" : mode === "rules" ? "Rules-based" : "Brief unavailable";
  const config = current?.configured === true ? "OpenAI configured" : current?.configured === false ? "OpenAI not configured" : loading ? "Checking OpenAI availability" : "OpenAI status unavailable";
  const reason = current?.reason === "request_unavailable" ? "The AI connection could not be checked. Any summary shown is rules-based." : REASONS[current?.reason];
  return <section className="daily-brief" aria-labelledby="daily-brief-title" aria-busy={loading}>
    <div className="section-title-row"><div><span className="section-kicker">Today at a glance</span><h2 id="daily-brief-title">Your daily health brief</h2></div><span className="brief-source">{source}</span></div>
    <div className="insight insight-blue daily-brief-narrative"><Icon name="sparkle" size={26} /><div><h3>How is your health looking today?</h3><p>{brief.narrative}</p></div></div>
    <p className="brief-status" role="status">{config}{current?.cached ? " · Cached brief" : ""}{loading ? " · Checking for an updated brief…" : ""}{reason ? `. ${reason}` : ""}</p>
    <div className="daily-brief-themes">
      {brief.themes.map((theme) => <article className="daily-brief-card" key={theme.id}>
        <div className="section-title-row"><h3>{BRIEF_THEMES.find(({ id }) => id === theme.id)?.label}</h3><span className={`brief-rating brief-rating-${theme.rating}`}>{RATING_LABELS[theme.rating]}</span></div>
        <p>{theme.summary}</p>
        <ul className="brief-evidence" aria-label={`${BRIEF_THEMES.find(({ id }) => id === theme.id)?.label} evidence`}>{theme.evidence.map((evidence) => <li key={evidence}>{evidence}</li>)}</ul>
        <p className="brief-uncertainty"><strong>Limit:</strong> {theme.uncertainty}</p>
      </article>)}
    </div>
    <p className="coverage">Wellness context only, not a medical assessment. The brief uses aggregate measurements and does not include personal notes or pain reports.</p>
  </section>;
}
