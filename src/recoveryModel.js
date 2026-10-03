import { isSamplePayload } from './portalData.js';
// Local wellness decision support. These conservative rules are not a medical assessment.
export const RECOVERY_STORAGE_KEY = 'tong-fit:recovery:v1';
export const EMPTY_CHECK_IN = { painLocation: '', painSeverity: '', fatigue: '' };

export function finiteNumber(value) {
  if (value == null || typeof value === 'boolean' || typeof value === 'object' || (typeof value === 'string' && !value.trim())) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validRpe(value) {
  const parsed = finiteNumber(value);
  return parsed != null && parsed >= 1 && parsed <= 10 ? parsed : null;
}

export function validateCheckIn(input) {
  const pain = finiteNumber(input?.painSeverity), fatigue = finiteNumber(input?.fatigue);
  if (pain == null || pain < 0 || pain > 10 || !Number.isInteger(pain)) return 'Choose pain severity from 0 to 10, including 0 for no pain.';
  if (pain > 0 && !String(input?.painLocation || '').trim()) return 'Choose where you feel pain.';
  if (fatigue == null || fatigue < 0 || fatigue > 10 || !Number.isInteger(fatigue)) return 'Choose fatigue from 0 to 10, including 0 for no fatigue.';
  return '';
}

export function sourceFreshness(payload, now = Date.now()) {
  const freshness = payload?.recap?.freshness || {};
  const rows = [{ id: 'hevy', label: 'Hevy', ...freshness.hevy }, ...Object.entries(freshness.google_health || {}).map(([id, item]) => ({ id, label: id.replaceAll('-', ' '), ...item }))];
  for (const [id, label] of [['sleep', 'Sleep'], ['daily-heart-rate-variability', 'HRV'], ['daily-resting-heart-rate', 'Resting heart rate'], ['steps', 'Steps']]) {
    if (!rows.some((row) => row.id === id)) rows.push({ id, label });
  }
  return rows.map((row) => {
    const measuredAt = row.recorded_at || row.start_time || null;
    const measureTime = Date.parse(measuredAt || ''), syncTime = Date.parse(row.synced_at || '');
    const ageHours = Number.isFinite(measureTime) ? (now - measureTime) / 3600000 : null;
    const syncAgeHours = Number.isFinite(syncTime) ? (now - syncTime) / 3600000 : null;
    // A recent synchronization does not make an old measurement current.
    const stale = ageHours == null || ageHours < -1 || ageHours > (row.id === 'hevy' ? 168 : 48) || syncAgeHours == null || syncAgeHours < -1 || syncAgeHours > 48;
    return { ...row, measuredAt, ageHours, syncAgeHours, status: !measuredAt || !row.synced_at ? 'missing' : stale ? 'stale' : 'current' };
  });
}

export function recoveryContextKey(payload, settings) {
  // No generated_at: a cache refresh with identical evidence is the same context.
  return JSON.stringify({ version: 1, freshness: payload?.recap?.freshness || null, summary: payload?.recap?.summary || null, goals: settings?.goals, training: settings?.training, personal: settings?.personal });
}

export function buildRecoveryDecision(payload, settings, input, now = Date.now()) {
  const normalized = { painLocation: String(input?.painLocation || '').slice(0, 80), painSeverity: finiteNumber(input?.painSeverity), fatigue: finiteNumber(input?.fatigue) };
  const result = { version: 1, decision: 'unknown', title: 'Not enough evidence to recommend training', input: normalized, reasons: [], modifications: ['Keep activity easy and pain-free until you have a current check-in and reliable data.'], appliedAt: new Date(now).toISOString(), contextKey: recoveryContextKey(payload, settings), confidence: 'Low' };
  const error = validateCheckIn(normalized);
  if (error) return { ...result, reasons: [error] };
  if (normalized.painSeverity >= 7 || normalized.fatigue >= 8) return { ...result, decision: 'rest', title: 'Rest from strenuous training today', reasons: [normalized.painSeverity >= 7 ? 'Your submitted pain is high.' : 'Your submitted fatigue is high.'], modifications: ['Avoid strenuous training and movements that cause pain.', 'Seek qualified medical advice for severe, persistent, or worsening pain, or unusual symptoms.'] };
  if (normalized.painSeverity > 0) return { ...result, decision: 'reduce', title: 'Reduce and avoid painful movements', reasons: [`You reported pain in ${normalized.painLocation}. A fitness app cannot assess its cause.`], modifications: ['Do not increase load or train through pain.', 'Skip painful exercises; choose only comfortable, easy movement.', 'If pain persists or worsens, seek qualified medical advice.'] };
  if (!payload || isSamplePayload(payload)) return { ...result, reasons: ['Current personal source data is unavailable. Sample values cannot support a recommendation.'] };
  const sources = sourceFreshness(payload, now), required = ['sleep', 'daily-heart-rate-variability', 'daily-resting-heart-rate'];
  const missing = sources.filter((row) => required.includes(row.id) && row.status !== 'current');
  if (missing.length) return { ...result, reasons: [`Current measurements and sync times are needed for: ${missing.map((row) => row.label).join(', ')}.`] };
  const summary = payload.recap?.summary || {}, sleep = summary.sleep?.asleep_minutes, hrv = summary.recovery?.hrv_ms, hr = summary.recovery?.resting_heart_rate_bpm;
  const latestSleep = finiteNumber(sleep?.latest), hrvNow = finiteNumber(hrv?.latest), hrvAvg = finiteNumber(hrv?.average), hrNow = finiteNumber(hr?.latest), hrAvg = finiteNumber(hr?.average);
  if ([latestSleep, hrvNow, hrvAvg, hrNow, hrAvg].some((value) => value == null) || !(hrvAvg > 0) || !(hrAvg > 0) || !(hrvNow > 0) || !(hrNow > 0) || latestSleep < 0 || latestSleep > 1440 || !(finiteNumber(hrv?.count) >= 3) || !(finiteNumber(hr?.count) >= 3)) return { ...result, reasons: ['Sleep, HRV and resting-heart-rate readings need a usable personal baseline (at least three readings).'] };
  const concerns = [];
  if (latestSleep < 360) concerns.push('The latest logged sleep is under six hours.');
  if (hrvNow < hrvAvg * 0.8) concerns.push('Latest HRV is more than 20% below the available average.');
  if (hrNow > hrAvg * 1.1) concerns.push('Latest resting heart rate is more than 10% above the available average.');
  if (normalized.fatigue >= 5) concerns.push('Your submitted fatigue is elevated.');
  if (String(settings?.personal?.limitations || '').trim() || String(settings?.personal?.precautions || '').trim() || String(settings?.personal?.previousInjuries || '').trim()) return { ...result, reasons: ['Your saved profile includes limitations, previous injuries or precautions. These free-text constraints need individual review.'], modifications: ['Follow any existing professional restrictions.', 'Do not use automatic load progression until the affected movements have been reviewed.'] };
  if (concerns.length) return { ...result, decision: 'reduce', title: 'Reduce today’s training', confidence: 'Low', reasons: concerns, modifications: ['Use an easier load and fewer sets than usual.', 'Stay comfortably below your effort cap; do not push to failure.', 'Stop if pain or unusual symptoms develop.'] };
  return { ...result, decision: 'train', title: 'Train as planned, with a check-in', confidence: 'Moderate', reasons: ['Your submitted check-in is pain-free with manageable fatigue.', 'Available sleep, HRV and resting-heart-rate readings show no flagged decline under these conservative rules.'], modifications: ['Start with a comfortable warm-up and reassess how you feel.', 'Keep to your configured effort target; increasing the load is optional.', 'Stop or reduce if pain, unusual symptoms or unexpected fatigue appears.'] };
}

export function recoveryState(applied, payload, settings, now = Date.now()) {
  const sameDay = applied?.appliedAt && new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(applied.appliedAt)) === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(now));
  const inputsExpired = !Number.isFinite(Date.parse(applied?.appliedAt || '')) || now - Date.parse(applied?.appliedAt || '') > 12 * 3600000;
  const sourcesExpired = applied?.decision === 'train' && sourceFreshness(payload, now).some((row) => ['sleep', 'daily-heart-rate-variability', 'daily-resting-heart-rate'].includes(row.id) && row.status !== 'current');
  const stale = !applied || !sameDay || inputsExpired || sourcesExpired || applied.contextKey !== recoveryContextKey(payload, settings);
  return applied ? { ...applied, stale, decision: stale ? 'unknown' : applied.decision } : { decision: 'unknown', stale: true, input: EMPTY_CHECK_IN, reasons: ['Submit today’s check-in on Recovery.'], modifications: [], contextKey: null };
}

export function loadRecovery(storage = globalThis.localStorage) {
  try {
    const saved = JSON.parse(storage?.getItem(RECOVERY_STORAGE_KEY) || 'null');
    if (saved?.version !== 1 || !saved.input || validateCheckIn(saved.input)) return null;
    // Recalculate every new page session. Saved inputs are convenience, never evidence of current readiness.
    return { input: saved.input };
  } catch { return null; }
}

export function persistRecovery(applied, storage = globalThis.localStorage) {
  try { storage?.setItem(RECOVERY_STORAGE_KEY, JSON.stringify({ version: 1, input: applied.input })); return true; } catch { return false; }
}
