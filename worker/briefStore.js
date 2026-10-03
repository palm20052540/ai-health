import { REPORT_VERSION, buildReportHash, buildReportInput, validateReportOutput } from "../src/assistantReports.js";

export const REPORT_KINDS = ["daily", "training"];
const MAX_REPORT_AGE = 24 * 60 * 60 * 1000;

export function requireReportKind(kind) {
  if (!REPORT_KINDS.includes(kind)) throw Object.assign(new Error("Choose daily or training."), { status: 400 });
  return kind;
}

function requireStore(env) {
  if (!env.BRIEF_DB?.prepare) throw Object.assign(new Error("Private summary storage is unavailable."), { status: 503 });
  return env.BRIEF_DB;
}

function unavailable(kind, reason, status = "unavailable") {
  return { status, kind, report: null, generatedAt: null, sourceAt: null, sourceHash: null, reason };
}

function evidenceInput(current) {
  const { sourceHash: _hash, ...input } = current;
  return input;
}

export async function readReportInput(kind, readDashboard, now = Date.now()) {
  requireReportKind(kind);
  const payload = await readDashboard(28);
  const input = buildReportInput(kind, payload, now);
  const sourceHash = await buildReportHash(input);
  return { ...input, sourceHash };
}

export async function readSavedReport(env, ownerId, kind, readDashboard, now = Date.now()) {
  requireReportKind(kind);
  const db = requireStore(env);
  const current = await readReportInput(kind, readDashboard, now);
  if (current.dataState !== "live") return unavailable(kind, `Current source evidence is ${current.dataState}; saved interpretation is withheld.`);
  const row = await db.prepare("SELECT source_hash, source_at, generated_at, version, report_json FROM assistant_briefs WHERE owner_id = ? AND kind = ?").bind(ownerId, kind).first();
  if (!row) return unavailable(kind, "No assistant-generated summary has been saved yet.", "missing");
  const generatedAt = new Date(row.generated_at).toISOString();
  if (row.version !== REPORT_VERSION || row.source_hash !== current.sourceHash || now - row.generated_at > MAX_REPORT_AGE || row.generated_at > now + 60000) {
    return { ...unavailable(kind, "Source evidence or the Bangkok day changed. An updated assistant summary is needed.", "stale"), generatedAt, sourceAt: row.source_at, sourceHash: row.source_hash };
  }
  try {
    const report = validateReportOutput(kind, JSON.parse(row.report_json), evidenceInput(current), now);
    return { status: "ready", kind, report, generatedAt, sourceAt: row.source_at, sourceHash: row.source_hash, reason: "Saved by the assistant from this source snapshot." };
  } catch {
    return unavailable(kind, "The saved summary did not pass current evidence checks.");
  }
}

export async function saveReport(env, ownerId, args, readDashboard, now = Date.now()) {
  const kind = requireReportKind(args?.kind);
  if (typeof args.sourceHash !== "string" || !/^[a-f0-9]{64}$/.test(args.sourceHash)) throw Object.assign(new Error("A valid source hash from get_brief_input is required."), { status: 400 });
  const db = requireStore(env);
  // Never trust a caller-submitted snapshot or accept analysis of an older sync.
  const current = await readReportInput(kind, readDashboard, now);
  if (current.dataState !== "live" || current.sourceHash !== args.sourceHash) throw Object.assign(new Error("Source evidence changed or is unavailable. Read a new input before saving."), { status: 409 });
  const report = validateReportOutput(kind, args.report, evidenceInput(current), now);
  const reportJson = JSON.stringify(report);
  if (reportJson.length > 32000) throw Object.assign(new Error("Summary exceeds the storage limit."), { status: 400 });
  const existing = await db.prepare("SELECT source_hash, source_at, generated_at, version, report_json FROM assistant_briefs WHERE owner_id = ? AND kind = ?").bind(ownerId, kind).first();
  // A replay keeps the original generation time rather than making old work appear new.
  if (!(existing?.source_hash === current.sourceHash && existing?.version === REPORT_VERSION && existing?.report_json === reportJson)) {
    await db.prepare("INSERT INTO assistant_briefs (owner_id, kind, source_hash, source_at, generated_at, version, report_json) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(owner_id, kind) DO UPDATE SET source_hash = excluded.source_hash, source_at = excluded.source_at, generated_at = excluded.generated_at, version = excluded.version, report_json = excluded.report_json WHERE excluded.generated_at >= assistant_briefs.generated_at")
      .bind(ownerId, kind, current.sourceHash, current.sourceAt, now, REPORT_VERSION, reportJson).run();
  }
  // Read-back rechecks current sources. A concurrent sync can immediately mark it stale.
  return readSavedReport(env, ownerId, kind, readDashboard, now);
}
