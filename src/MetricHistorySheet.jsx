import React from "react";
import { BottomSheet, ContextDetails, RangeControl } from "./components";
import { buildMetricHistory, historyDate } from "./metricHistory.js";

export function MetricHistorySheet({ metric, payload, range, dataState, returnTab = "Health", onRangeChange, onClose }) {
  const history = buildMetricHistory(payload, metric, range, dataState);
  const unavailable = ["missing", "sample", "unavailable"].includes(history.status);
  return <BottomSheet title={`${metric} history`} onClose={onClose}>
    <div className="metric-history">
      <p className="sheet-lead">{history.source} records · newest first · Bangkok time</p>
      <RangeControl value={range} onChange={onRangeChange} />

      {history.status === "loading" ? <p role="status" className="empty-state compact">Loading records for this period…</p> : unavailable ? <p role="status" className="empty-state compact">{history.status === "sample" ? "Sample data is not personal history." : "Historical records are unavailable. Try another period or Sync when the connection is available."}</p> : <>
        {history.status === "stale" ? <p className="data-note" role="status">Cached records · refresh before relying on them.</p> : null}
        <p className="history-coverage">{history.rows.length} returned records · {history.available} with a value{history.missing ? ` · ${history.missing} unavailable` : ""}</p>
        <ContextDetails title="Coverage and source details"><p className="history-coverage">Requested period: {history.days} days. Only records already stored by the source are available.</p>
        {metric === "Weight" ? <p className="history-coverage">The source returns at most the latest {history.days} measurements. Dated records outside this period are excluded; older records may not be included.</p> : null}
        {metric === "Sleep" ? <p className="history-coverage">Duration is time asleep. Dates are source record timestamps, not reconstructed bedtimes.</p> : null}
        {metric === "Steps" || metric === "Active zone minutes" ? <p className="history-coverage">A completed calendar day does not guarantee full device coverage.</p> : null}
        {history.snapshotAt ? <p className="history-coverage">Snapshot retrieved {historyDate(history.snapshotAt)}. Retrieval time is not the measurement time.</p> : null}</ContextDetails>
        {history.rows.length ? <ol className="history-records" aria-label={`${metric} historical records`}>{history.rows.map((row) => <li key={row.id} className="history-record">
          <div>{row.instant ? <time dateTime={row.instant}>{row.displayDate}</time> : <span>{row.displayDate}</span>}{!row.instant || row.note.startsWith("Partial") ? <small>{row.note}</small> : null}</div>
          <strong className={row.available ? "" : "history-missing"}>{row.displayValue}</strong>
        </li>)}</ol> : <p className="empty-state compact">No {metric.toLowerCase()} records returned for this period. Missing days are not filled with zero.</p>}
      </>}
      <button type="button" className="secondary-button full" onClick={onClose}>Back to {returnTab} metrics</button>
    </div>
  </BottomSheet>;
}
