import { VISIBLE_TABS } from "./navigation";
import React, { useEffect, useId, useRef } from "react";
import { Icon } from "./icons";

export function Header({ syncing, onSync, onSettings, status, lastSynced }) {
  return (
    <header className="app-header">
      <div className="brand-block">
        <div className="brand">ต๊อง <span>Fit</span></div>
        <div className="brand-subtitle">AI Health Portal <span className={`data-status ${status === "Live data" ? "live" : ""}`}>{status}</span></div>
      </div>
      <button type="button" className="icon-button" aria-label="Open settings" onClick={onSettings}><Icon name="settings" size={26} /></button>
      <div className="sync-row">
        <span role="status" aria-live="polite">{syncing ? "Checking data freshness…" : `Last synced: ${lastSynced || "—"}`}</span>
        <button type="button" className="sync-button" onClick={onSync} disabled={syncing}>
          <span className={syncing ? "spin" : ""}><Icon name="sync" size={20} /></span>{syncing ? "Syncing" : "Sync now"}
        </button>
      </div>
    </header>
  );
}

export function RangeControl({ value, onChange }) {
  return <div className="range-control" role="group" aria-label="Time range">{["7D", "30D", "3M", "6M", "1Y"].map((range) => (
    <button type="button" key={range} aria-pressed={value === range} className={value === range ? "active" : ""} onClick={() => onChange(range)}>{range}</button>
  ))}</div>;
}

export function Insight({ tone = "blue", icon = "sparkle", title, copy }) {
  return (
    <section className={`insight insight-${tone}`}>
      <Icon name={icon} size={30} />
      <div><h2>{title}</h2><p>{copy}</p></div>
    </section>
  );
}

export function EvidenceRow({ items, onMetric }) {
  return <div className="evidence-row">{items.map((item) => (
    <button type="button" key={item.label} onClick={() => onMetric?.(item.metric || item.label)}>
      <span className="evidence-label">{item.label}</span>
      <strong>{item.value}</strong>
      <span className={`evidence-delta ${item.tone || ""}`}>{item.delta}</span>
    </button>
  ))}</div>;
}

function points(values, width = 286, height = 126) {
  if (!Array.isArray(values) || values.length < 2) return [];
  const min = Math.min(...values) - .5;
  const max = Math.max(...values) + .5;
  return values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / (max - min || 1)) * height;
    return [x, y];
  });
}

export function TrendChart({ data }) {
  const hasData = data.series.some((series) => series.values.length > 0);
  if (!hasData) return <section className="chart-section"><h2>{data.title}</h2><p className="empty-state compact">No recorded points in this period.</p></section>;
  const summary = data.series.map((series) => `${series.name}: ${series.values.length ? series.values.at(-1) + " at the latest point" : "no recorded points"}`).join(". ");
  return (
    <section className="chart-section">
      <div className="section-title-row">
        <h2>{data.title}</h2>
        <div className="legend">{data.series.map((series) => <span key={series.name}><i style={{ background: series.color }} />{series.name}</span>)}</div>
      </div>
      <div className="chart-wrap">
        <svg viewBox="0 0 310 160" role="img" aria-label={`${data.title} line chart. ${summary}`}>
          <desc>{summary}</desc>
          {[18, 54, 90, 126].map((y) => <line key={y} x1="4" x2="304" y1={y} y2={y} className="grid-line" />)}
          {data.series.map((series) => {
            const line = points(series.values);
            return <g key={series.name}>
              <polyline points={line.map((p) => p.join(",")).join(" ")} fill="none" stroke={series.color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              {line.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="3.5" fill={series.color} />)}
            </g>;
          })}
        </svg>
        <div className="chart-labels">{data.labels.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}</div>
      </div>
    </section>
  );
}

export function MetricRow({ icon, label, meta, value, delta, tone = "blue", onClick }) {
  return (
    <button type="button" className="metric-row" onClick={onClick}>
      <span className={`metric-icon ${tone}`}><Icon name={icon} size={22} /></span>
      <span className="metric-copy"><strong>{label}</strong><small>{meta}</small></span>
      <strong className="metric-value">{value}</strong>
      <span className="metric-delta">{delta}</span>
      <Icon name="chevron" size={18} className="chevron" />
    </button>
  );
}

export function Sparkline({ values, color = "#146BFA" }) {
  const line = points(values, 106, 30);
  return <svg className="sparkline" viewBox="0 0 106 30" aria-hidden="true"><polyline points={line.map((p) => p.join(",")).join(" ")} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />{line.map(([x, y], index) => <circle key={index} cx={x} cy={y} r="2.1" fill={color} />)}</svg>;
}

export function BottomNav({ active, onChange }) {
  return <nav className="bottom-nav" aria-label="Primary navigation">{VISIBLE_TABS.map((tab) => (
    <button type="button" key={tab.label} aria-current={active === tab.label ? "page" : undefined} className={active === tab.label ? "active" : ""} onClick={() => onChange(tab.label)}>
      <Icon name={tab.icon} size={25} /><span>{tab.label}</span>
    </button>
  ))}</nav>;
}

export function BottomSheet({ title, children, onClose }) {
  const titleId = useId();
  const sheetRef = useRef(null);
  const closeRef = useRef(null);
  const returnFocusRef = useRef(document.activeElement);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKeyDown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== "Tab") return;
      const focusable = [...sheetRef.current.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      returnFocusRef.current?.focus?.();
    };
  }, []);

  return <div className="sheet-backdrop" onMouseDown={onClose} role="presentation"><section ref={sheetRef} className="bottom-sheet" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId}>
    <div className="sheet-handle" />
    <div className="sheet-title"><h2 id={titleId}>{title}</h2><button type="button" ref={closeRef} className="icon-button" onClick={onClose} aria-label={`Close ${title}`}><Icon name="close" size={22} /></button></div>
    {children}
  </section></div>;
}

export function ContextDetails({ title = "Details", children }) {
  return <details className="context-details"><summary>{title}</summary><div>{children}</div></details>;
}
