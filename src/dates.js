// PostgREST returns *_bangkok generated columns as timestamp-without-time-zone.
// Treat those local wall-clock values as Asia/Bangkok, never the browser's zone.
export function sourceInstant(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  let text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += 'T00:00:00+07:00';
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(text)) text = text.replace(' ', 'T') + '+07:00';
  const stamp = Date.parse(text);
  return Number.isFinite(stamp) ? new Date(stamp).toISOString() : null;
}
