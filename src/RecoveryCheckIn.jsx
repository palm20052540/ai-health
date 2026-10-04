import React, { useState } from 'react';
import { ContextDetails } from './components';
import { EMPTY_CHECK_IN, loadRecovery, validateCheckIn } from './recoveryModel';
import { formatGeneratedAt } from './portalData';

export function RecoveryCheckIn({ recovery, onApply, applying, error, settings, openGoals, storage }) {
  const [draft, setDraft] = useState(() => loadRecovery(storage)?.input || { ...EMPTY_CHECK_IN });
  const [validation, setValidation] = useState('');
  const decisionTitles = { train: 'Train as planned', reduce: 'Take an easier session', rest: 'Rest today', unknown: 'Hold the training decision' };
  const dirty = JSON.stringify(draft) !== JSON.stringify(recovery?.input);
  const update = (key, value) => { setDraft((current) => ({ ...current, [key]: value })); setValidation(''); };
  const submit = (event) => { event.preventDefault(); const message = validateCheckIn(draft); setValidation(message); if (!message && !applying) onApply({ ...draft }); };
  return <section className="recovery-check-in">
    <div className="decision-card" aria-live="polite"><span className="eyebrow">Today’s plan · rule-guided</span><h2>{recovery.stale ? 'Check in before training' : decisionTitles[recovery.decision] || recovery.title}</h2>
      {recovery.stale ? <p>Tell me how you feel below, then update your plan. There is no current training decision yet.</p> : <><p>{recovery.reasons[0]}</p><ul>{recovery.modifications.map((item) => <li key={item}>{item}</li>)}</ul><ContextDetails title="Why this recommendation"><p>{recovery.reasons.slice(1).join(" ")}</p><small>Confidence: {recovery.confidence} · Applied {formatGeneratedAt(recovery.appliedAt)}</small></ContextDetails></>}
    </div>
    <div className="section-title-row"><h2>How do you feel?</h2><button type="button" className="text-button" onClick={openGoals}>Goal: {settings.goals.primary}</button></div>
    <form className="settings-form recovery-form" onSubmit={submit}>
      <label className="form-field"><span>Pain location</span><select value={draft.painLocation} onChange={(event) => update('painLocation', event.target.value)}><option value="">Choose location if in pain</option>{['Neck', 'Shoulder', 'Elbow', 'Wrist or hand', 'Back', 'Hip', 'Knee', 'Ankle or foot', 'Multiple areas', 'Other'].map((location) => <option key={location}>{location}</option>)}</select></label>
      <div className="form-grid">{[['painSeverity', 'Pain severity', '0 = none · 10 = severe'], ['fatigue', 'Fatigue', '0 = fresh · 10 = exhausted']].map(([key, label, hint]) => <label className="form-field" key={key}><span>{label}</span><select value={draft[key] ?? ''} onChange={(event) => update(key, event.target.value === '' ? '' : Number(event.target.value))}><option value="">Choose 0–10</option>{Array.from({ length: 11 }, (_, value) => <option key={value} value={value}>{value}</option>)}</select><small>{hint}</small></label>)}</div>
      <p className="coverage">{recovery.stale ? 'Check-in not applied yet.' : dirty ? 'Draft changes are not applied yet.' : 'Your submitted check-in is applied.'}</p>
      {validation || error ? <p className="form-error" role="alert">{validation || error}</p> : null}
      <button type="submit" disabled={applying} className="primary-button full">{applying ? 'Updating recommendations…' : 'Update recommendations'}</button>
      <ContextDetails title="How updates work"><p className="storage-note">This refreshes current source data and recalculates using the submitted check-in and saved goal. Check-in inputs and settings stay in this browser; cross-device sync is not enabled. RPE comes from your Hevy logs; you do not need to enter it again.</p></ContextDetails>
    </form>
    <p className="safety-note">Stop painful movements. Get medical advice for severe, persistent or worsening symptoms.</p>
    <ContextDetails title="Method and safety"><p className="coverage">These are conservative, unvalidated wellness heuristics, not a readiness test. They need current sleep, HRV and resting-heart-rate data with at least three baseline readings; a missing source means no automatic clearance. Wellness guidance only. Seek qualified medical care for severe, persistent or worsening pain or unusual symptoms.</p></ContextDetails>
  </section>;
}
