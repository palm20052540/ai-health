import React, { useState } from "react";
import { BottomSheet } from "./components";
import { Icon } from "./icons";
import { settingSummaries } from "./settings";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function Field({ label, children, hint }) {
  return <label className="form-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

function DayPicker({ value, onChange }) {
  const selected = new Set(value);
  return <div className="day-picker" role="group" aria-label="Days of week">{DAYS.map((day) => <button type="button" aria-label={day} aria-pressed={selected.has(day)} className={selected.has(day) ? "active" : ""} key={day} onClick={() => onChange(selected.has(day) ? value.filter((item) => item !== day) : [...value, day])}>{day.slice(0, 1)}</button>)}</div>;
}

function GoalsForm({ draft, setDraft }) {
  return <>
    <Field label="Primary goal"><select value={draft.primary} onChange={(event) => setDraft({ ...draft, primary: event.target.value })}><option>Physique</option><option>Strength</option><option>General fitness</option><option>Fat loss</option></select></Field>
    <div className="form-grid"><Field label="Duration (weeks)"><input type="number" min="1" max="104" value={draft.durationWeeks} onChange={(event) => setDraft({ ...draft, durationWeeks: Number(event.target.value) })} /></Field><Field label="Target weight (kg)"><input type="number" min="20" max="300" step="0.1" placeholder="Optional" value={draft.targetWeightKg} onChange={(event) => setDraft({ ...draft, targetWeightKg: event.target.value })} /></Field></div>
    <Field label="Training frequency"><input type="number" min="1" max="7" value={draft.trainingFrequency} onChange={(event) => setDraft({ ...draft, trainingFrequency: Number(event.target.value) })} /></Field>
    <Field label="Exercises to improve"><textarea rows="3" value={draft.focusExercises} onChange={(event) => setDraft({ ...draft, focusExercises: event.target.value })} placeholder="Bench Press, Squat…" /></Field>
  </>;
}

function TrainingForm({ draft, setDraft }) {
  return <>
    <Field label="Training days"><DayPicker value={draft.days} onChange={(days) => setDraft({ ...draft, days })} /></Field>
    <Field label="Rest days"><DayPicker value={draft.restDays} onChange={(restDays) => setDraft({ ...draft, restDays })} /></Field>
    <div className="form-grid"><Field label="Equipment"><select value={draft.equipment} onChange={(event) => setDraft({ ...draft, equipment: event.target.value })}><option>Full gym</option><option>Home gym</option><option>Dumbbells only</option><option>Bodyweight</option></select></Field><Field label="Style"><select value={draft.style} onChange={(event) => setDraft({ ...draft, style: event.target.value })}><option>Hypertrophy</option><option>Strength</option><option>Mixed</option><option>Conditioning</option></select></Field></div>
    <div className="form-grid"><Field label="Target RPE"><input type="number" min="5" max="10" step="0.5" value={draft.targetRpe} onChange={(event) => setDraft({ ...draft, targetRpe: Number(event.target.value) })} /></Field><Field label="Maximum RPE"><input type="number" min="5" max="10" step="0.5" value={draft.maxRpe} onChange={(event) => setDraft({ ...draft, maxRpe: Number(event.target.value) })} /></Field></div>
    <div className="form-grid"><Field label="Sets / muscle min"><input type="number" min="1" max="40" value={draft.targetSetsMin} onChange={(event) => setDraft({ ...draft, targetSetsMin: Number(event.target.value) })} /></Field><Field label="Sets / muscle max"><input type="number" min="1" max="50" value={draft.targetSetsMax} onChange={(event) => setDraft({ ...draft, targetSetsMax: Number(event.target.value) })} /></Field></div>
  </>;
}

function PersonalForm({ draft, setDraft }) {
  return <>
    <div className="form-grid"><Field label="Age"><input type="number" min="13" max="120" value={draft.age} onChange={(event) => setDraft({ ...draft, age: event.target.value })} /></Field><Field label="Height (cm)"><input type="number" min="100" max="250" value={draft.heightCm} onChange={(event) => setDraft({ ...draft, heightCm: event.target.value })} /></Field></div>
    <Field label="Physical limitations"><textarea rows="3" value={draft.limitations} onChange={(event) => setDraft({ ...draft, limitations: event.target.value })} placeholder="Movement restrictions or conditions to account for" /></Field>
    <Field label="Previous injuries"><textarea rows="3" value={draft.previousInjuries} onChange={(event) => setDraft({ ...draft, previousInjuries: event.target.value })} /></Field>
    <Field label="AI precautions"><textarea rows="3" value={draft.precautions} onChange={(event) => setDraft({ ...draft, precautions: event.target.value })} placeholder="What recommendations should avoid" /><small>Saved constraints make automatic progression unavailable until individually reviewed.</small></Field>
  </>;
}

function AnalyticsForm({ draft, setDraft }) {
  return <>
    <div className="form-grid"><Field label="Units"><select value={draft.unit} onChange={(event) => setDraft({ ...draft, unit: event.target.value })}><option value="kg">kg</option><option value="lb">lb</option></select></Field><Field label="Baseline days"><select value={draft.baselineDays} onChange={(event) => setDraft({ ...draft, baselineDays: Number(event.target.value) })}><option value="14">14 days</option><option value="28">28 days</option><option value="42">42 days</option><option value="90">90 days</option></select></Field></div>
    <Field label="Comparison"><select value={draft.comparison} onChange={(event) => setDraft({ ...draft, comparison: event.target.value })}><option>Personal baseline</option><option>Previous period</option><option>Best period</option></select></Field>
    <Field label="Featured metrics"><textarea rows="3" value={draft.featuredMetrics.join(", ")} onChange={(event) => setDraft({ ...draft, featuredMetrics: event.target.value.split(",").map((item) => item.trim()).filter(Boolean) })} /></Field>
  </>;
}

function PhysiqueForm({ draft, setDraft, openPhotos }) {
  return <>
    <Field label="Goal physique"><textarea rows="5" value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Describe proportions, muscle groups, and overall look" /></Field>
    <button type="button" className="secondary-button full" onClick={openPhotos}><Icon name="camera" size={18} /> Manage reference & progress photos</button>
  </>;
}

export function validateSection(section, draft) {
  const numeric = (value, min, max) => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max;
  if (section === 'goals' && (!numeric(draft.durationWeeks, 1, 104) || !numeric(draft.trainingFrequency, 1, 7))) return 'Enter a valid duration and training frequency.';
  if (section === 'training' && (!numeric(draft.targetRpe, 1, 10) || !numeric(draft.maxRpe, 1, 10) || !numeric(draft.targetSetsMin, 1, 40) || !numeric(draft.targetSetsMax, 1, 50))) return 'Enter valid RPE targets (1–10) and set limits.';
  if (section === "goals") {
    if (draft.durationWeeks < 1 || draft.durationWeeks > 104) return "Duration must be between 1 and 104 weeks.";
    if (draft.trainingFrequency < 1 || draft.trainingFrequency > 7) return "Training frequency must be between 1 and 7 days per week.";
    if (draft.targetWeightKg !== "" && (Number(draft.targetWeightKg) < 20 || Number(draft.targetWeightKg) > 300)) return "Target weight must be between 20 and 300 kg.";
  }
  if (section === "training") {
    if (!draft.days.length) return "Choose at least one training day.";
    const overlap = draft.days.filter((day) => draft.restDays.includes(day));
    if (overlap.length) return `${overlap.join(", ")} cannot be both training and rest days.`;
    if (Number(draft.targetRpe) > Number(draft.maxRpe)) return "Maximum RPE must be equal to or higher than target RPE.";
    if (Number(draft.targetSetsMin) > Number(draft.targetSetsMax)) return "Maximum sets must be equal to or higher than minimum sets.";
  }
  if (section === "analytics" && !draft.featuredMetrics.length) return "Add at least one featured metric.";
  return "";
}

const TITLES = { goals: "Goals", training: "Training preferences", personal: "Personal context", analytics: "Analytics", physique: "Goal physique" };

export function SettingsMenu({ settings, notice, onEdit, onReset, onClose }) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const summaries = settingSummaries(settings);
  return <BottomSheet title="Settings" onClose={onClose}>
    {notice ? <div className="settings-notice" role="status"><Icon name="check" size={18} /><span>{notice}</span></div> : null}
    <div className="settings-list">{Object.entries(TITLES).map(([key, title]) => <button type="button" key={key} onClick={() => onEdit(key)}><span><strong>{title}</strong><small>{summaries[key]}</small></span><Icon name="chevron" size={18} /></button>)}</div>
    <p className="storage-note">Saved privately in this browser. No health data is uploaded by these settings.</p>
    {confirmingReset ? <div className="reset-confirm" role="group" aria-label="Confirm reset settings"><p><strong>Reset all settings?</strong><span>This restores the original goals and preferences on this browser.</span></p><div><button className="secondary-button" type="button" onClick={() => setConfirmingReset(false)}>Cancel</button><button className="danger-button" type="button" onClick={onReset}>Reset</button></div></div> : <button className="reset-settings-button" type="button" onClick={() => setConfirmingReset(true)}>Reset settings</button>}
  </BottomSheet>;
}

export function SettingEditor({ section, settings, onSave, onClose, openPhotos }) {
  const [draft, setDraft] = useState(() => structuredClone(settings[section]));
  const [error, setError] = useState("");
  const Form = section === "goals" ? GoalsForm : section === "training" ? TrainingForm : section === "personal" ? PersonalForm : section === "analytics" ? AnalyticsForm : PhysiqueForm;
  const submit = (event) => {
    event.preventDefault();
    const nextError = validateSection(section, draft);
    setError(nextError);
    if (!nextError) onSave(section, draft);
  };
  return <BottomSheet title={TITLES[section]} onClose={onClose}><form className="settings-form" onSubmit={submit}><Form draft={draft} setDraft={(next) => { setDraft(next); setError(""); }} openPhotos={openPhotos} />{error ? <div className="form-error" role="alert">{error}</div> : null}<button className="primary-button full" type="submit">Save changes</button></form></BottomSheet>;
}
