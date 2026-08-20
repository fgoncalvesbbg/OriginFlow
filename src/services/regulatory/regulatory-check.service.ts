/**
 * Client for the server-side AI regulatory check (netlify/functions/regulatory-check.ts).
 *
 * One run audits ONE template's English content against every regulation assigned to
 * it, and stores an immutable report in `im_regulatory_checks`. The Anthropic key lives
 * only on the server; the browser posts one (regulation × chunk) unit per request.
 *
 * Four design points that are load-bearing:
 *
 *  - THE SUMMARY IS NEVER SENT FROM THE BROWSER. The function reads the regulation
 *    (and its per-template scope note) server-side by (templateId, regulationId), which
 *    also makes "is this regulation actually assigned to this template?" a server-side
 *    authorization check rather than a client assertion.
 *
 *  - A FAILED UNIT NEVER FAILS THE RUN. It becomes an entry in `report.failures` and
 *    its siblings continue. Three regulations and one transient overload must not throw
 *    away two regulations' worth of findings — the same contract as the translate run
 *    report the team already reads.
 *
 *  - MODEL-SUPPLIED IDS ARE NEVER TRUSTED AS LOOKUP KEYS. A `sectionId`/`refId` that
 *    is not in the serialized document is cleared and the finding is flagged
 *    `unresolvedAnchor`, so the UI shows "not anchored" instead of a dead link.
 *
 *  - A VERBATIM PHRASE IS VERIFIED AGAINST THE REAL FREEZE IMPLEMENTATION BEFORE IT
 *    CAN BE REGISTERED. See verifyVerbatimPhrase — registering a phrase that
 *    `freezeVerbatims` cannot match would create an entry that looks protective while
 *    translation rewrites the text anyway.
 *
 * Like translation, this needs the Netlify Functions runtime: plain `vite` does not
 * serve it, so the first 404 latches and every later call fails fast with a message
 * saying to run `netlify dev`.
 */

import { auth, db, withDeadline, orEmpty, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type {
  IMBlock,
  IMSection,
  IMTemplate,
  RegCheckStatus,
  RegulatoryCheckFailure,
  RegulatoryCheckReport,
  RegulatoryCheckRun,
  RegulatoryFinding,
  RegulatoryVerbatim,
  TemplateRegulation,
  VerbatimVerification,
} from '../../types';
import { getIMSections, getIMBlocks } from '../im';
import { freeze, freezeVerbatims, countTokens } from '../im/im-chip-freeze';
import { createTranslationVerbatim, getTranslationVerbatims } from '../ai/translation-verbatim.service';
import { mapWithConcurrency } from '../core/save-retry';
import {
  chunkRegCheckDocument,
  serializeTemplateForRegCheck,
  type RegCheckDocument,
} from './regulatory-serialize';

const TAG = '[regulatory]';
const ENDPOINT = '/.netlify/functions/regulatory-check';
const READ_TIMEOUT_MS = 15000;

/**
 * Per-call abort. Below Netlify's ~26 s synchronous ceiling on purpose: a straggler
 * becomes a `failures[]` entry with a clear message instead of an opaque gateway error.
 */
const CALL_TIMEOUT_MS = 24_000;

/** Concurrent in-flight calls. Two, not more: each is a large-context reasoning
 *  request, and extra parallelism mostly buys 529s. */
const CONCURRENCY = 2;

const TRANSIENT_STATUSES = new Set([408, 502, 503, 504, 529]);
const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const SEVERITY_RANK: Record<string, number> = { critical: 0, major: 1, minor: 2, info: 3 };

let endpointMissing = false;
const ENDPOINT_MISSING_MESSAGE =
  'Regulatory check service not found (404). It runs as a Netlify function — run the app ' +
  'with `netlify dev` locally (plain `vite`/`npm run start` does not serve functions), or ' +
  'use the deployed site.';

/** Reset the 404 latch. Test-only seam; production never needs it. */
export const __resetRegCheckEndpointLatch = (): void => { endpointMissing = false; };

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

interface RawFinding {
  severity: string;
  kind: string;
  sectionId: string;
  refId: string;
  clause: string;
  requirement: string;
  issue: string;
  suggestedChange: string;
  quote: string;
}

interface RawVerbatim {
  phrase: string;
  clause: string;
  rationale: string;
  sectionId: string;
  refId: string;
  exactness: string;
}

interface RegulatoryCheckResponse {
  regulationId: string;
  chunkIndex: number;
  findings: RawFinding[];
  verbatims: RawVerbatim[];
  notes: string;
  model: string;
  truncated: boolean;
}

export interface RegCheckProgress {
  done: number;
  total: number;
  label: string;
}

/** `''` is the schema's "unknown" sentinel — normalize it away at the boundary. */
const opt = (v: unknown): string | undefined => {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : undefined;
};

const isRawFinding = (v: any): v is RawFinding =>
  !!v && typeof v === 'object' &&
  SEVERITY_RANK[v.severity] !== undefined &&
  typeof v.kind === 'string' &&
  typeof v.requirement === 'string' &&
  typeof v.issue === 'string' &&
  (v.requirement.trim() !== '' || v.issue.trim() !== '');

const isRawVerbatim = (v: any): v is RawVerbatim =>
  !!v && typeof v === 'object' &&
  typeof v.phrase === 'string' && v.phrase.trim() !== '' &&
  (v.exactness === 'exact' || v.exactness === 'near');

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * Load and serialize a template into the English audit document.
 *
 * `sections` may be passed in when the caller (the template editor) already holds
 * them, avoiding a redundant read of a large table.
 */
export const buildRegCheckDocument = async (
  template: IMTemplate,
  sections?: IMSection[],
): Promise<RegCheckDocument> => {
  const loaded = sections ?? await getIMSections(template.id);
  const needsBlocks = loaded.some((s) => (s.blockRefs ?? []).some((r) => r.kind === 'block'));
  // The library is small and cross-category, so one unfiltered read is cheaper than
  // filtering per block id — but skip it entirely when nothing references a block.
  const blocks: IMBlock[] = needsBlocks ? await getIMBlocks() : [];
  return serializeTemplateForRegCheck(template, loaded, blocks);
};

// ---------------------------------------------------------------------------
// One unit of work
// ---------------------------------------------------------------------------

const callCheck = async (
  body: Record<string, unknown>,
  token: string,
): Promise<RegulatoryCheckResponse> => {
  for (let attempt = 1; ; attempt++) {
    if (endpointMissing) throw new Error(ENDPOINT_MISSING_MESSAGE);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (e) {
      // An abort or a dropped connection is transient — retry, then give up with a
      // message that says which it was.
      if (attempt < MAX_ATTEMPTS) {
        await sleep(1000 * 3 ** (attempt - 1));
        continue;
      }
      const isAbort = e instanceof DOMException && e.name === 'TimeoutError';
      throw new Error(isAbort
        ? `The check call did not finish within ${CALL_TIMEOUT_MS / 1000}s.`
        : `The check call failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (res.ok) return (await res.json()) as RegulatoryCheckResponse;

    if (res.status === 404) {
      endpointMissing = true;
      throw new Error(ENDPOINT_MISSING_MESSAGE);
    }
    if (TRANSIENT_STATUSES.has(res.status) && attempt < MAX_ATTEMPTS) {
      const wait = 1000 * 3 ** (attempt - 1); // 1s, 3s
      console.warn(TAG, `transient ${res.status} — retrying in ${wait / 1000}s (attempt ${attempt}/${MAX_ATTEMPTS})`);
      await sleep(wait);
      continue;
    }
    let message = `Regulatory check failed (${res.status})`;
    try {
      const err = await res.json();
      if (err?.error) message = err.error;
    } catch {
      // non-JSON body — keep the status-based message
    }
    throw new Error(message);
  }
};

// ---------------------------------------------------------------------------
// Verbatim verification
// ---------------------------------------------------------------------------

/**
 * Would registering this phrase in `translation_verbatims` actually protect it?
 *
 * `freezeVerbatims` only substitutes a phrase that sits entirely inside ONE plain-prose
 * segment — it splits the fragment on tags and existing {{FRZ_n}} tokens first. So a
 * phrase crossing `<strong>`, or containing a literal space where the source HTML has
 * `&nbsp;`, can never match at translate time. Because the model's phrase comes from
 * TAG-STRIPPED text, that is the likely case, not an edge case: registering it would
 * create an entry that looks protective while translation rewrites the text anyway.
 *
 * This runs the REAL implementation rather than re-deriving the rule, so it stays
 * correct if the freeze rules ever change:
 *   'exact'          — freezing produced a token; registration works.
 *   'stripped-only'  — the phrase is in the section's visible text but not in a single
 *                      prose run; registration would be a no-op.
 *   'absent'         — not found at all (the model paraphrased, or it is from elsewhere).
 */
export const verifyVerbatimPhrase = (
  phrase: string,
  sections: IMSection[],
): VerbatimVerification => {
  const needle = phrase.trim();
  if (!needle) return 'absent';

  const fragments: string[] = [];
  for (const s of sections) {
    for (const ref of s.blockRefs ?? []) {
      if (ref.kind === 'inline') fragments.push(ref.content?.en ?? '');
    }
    if (s.content?.en) fragments.push(s.content.en);
  }

  let seenStripped = false;
  for (const html of fragments) {
    if (!html) continue;
    const frozen = freeze(html);
    const before = countTokens(frozen.text);
    const after = freezeVerbatims(frozen, [{ phrase: needle }]);
    if (countTokens(after.text) > before) return 'exact';
    // Present in the visible text but not freezable — record and keep looking, since
    // another block may carry a freezable copy of the same sentence.
    if (!seenStripped) {
      const visible = html.replace(/<[^>]+>/g, '').replace(/&nbsp;/gi, ' ');
      if (visible.includes(needle)) seenStripped = true;
    }
  }
  return seenStripped ? 'stripped-only' : 'absent';
};

/**
 * Register a verified verbatim finding into the EXISTING `translation_verbatims`
 * table, so translation freezes the phrase instead of translating it.
 *
 * The provenance note is not optional: it is the only way anyone later finds and
 * removes a bad registration from the Admin panel. Refuses anything the caller has not
 * verified as 'exact' — a `near` phrase is by definition NOT the mandated wording, and
 * a `stripped-only` phrase would be a silent no-op.
 */
export const registerVerbatimFinding = async (
  finding: RegulatoryVerbatim,
  createdBy?: string,
): Promise<'created' | 'already-registered'> => {
  if (finding.exactness !== 'exact' || finding.verification !== 'exact') {
    throw new Error(
      'This phrase cannot be registered: only wording that the template already carries ' +
      'word-for-word, and that can be frozen as a single run of text, is safe to protect.',
    );
  }
  const phrase = finding.phrase.trim();

  // `phrase` is UNIQUE — reuse an existing entry rather than colliding with the index.
  const existing = await getTranslationVerbatims();
  if (existing.some((v) => v.phrase === phrase)) return 'already-registered';

  const refs = finding.regulationReferences.filter(Boolean).join(', ');
  const clause = finding.clause ? ` ${finding.clause}` : '';
  await createTranslationVerbatim(
    {
      phrase,
      note: `${refs}${clause} — registered from the regulatory check of ` +
        `${new Date().toISOString().slice(0, 10)}.`,
    },
    createdBy,
  );
  return 'created';
};

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

const mapRun = (r: any): RegulatoryCheckRun => ({
  id: r.id,
  templateId: r.template_id,
  status: r.status as RegCheckStatus,
  report: r.report,
  regulationCount: r.regulation_count ?? 0,
  sectionCount: r.section_count ?? 0,
  findingCount: r.finding_count ?? 0,
  verbatimCount: r.verbatim_count ?? 0,
  model: r.model ?? undefined,
  promptKey: r.prompt_key ?? undefined,
  runBy: r.run_by ?? undefined,
  createdAt: r.created_at,
});

/**
 * Run the check for a template against all of its assigned regulations.
 *
 * Work units are the cross product (assignment × chunk). Never throws for a failed
 * unit — the returned report's `failures` says what is missing and `status` says how
 * complete it is.
 */
export const runRegulatoryCheck = async (params: {
  template: IMTemplate;
  sections?: IMSection[];
  assignments: TemplateRegulation[];
  runBy?: string;
  onProgress?: (p: RegCheckProgress) => void;
}): Promise<RegulatoryCheckRun> => {
  const { template, assignments, runBy, onProgress } = params;
  if (!assignments.length) {
    throw new Error('Assign at least one regulation to this template before running a check.');
  }

  const session = await auth.getSession();
  const token = session?.accessToken;
  if (!token) throw new Error('You must be signed in to run a regulatory check.');

  const sections = params.sections ?? await getIMSections(template.id);
  const doc = await buildRegCheckDocument(template, sections);
  const chunks = chunkRegCheckDocument(doc);

  // Valid anchors, so a model-supplied id is checked rather than trusted.
  const sectionMeta = new Map(doc.sections.map((s) => [s.sectionId, s]));
  const refIds = new Set(doc.sections.flatMap((s) => s.blocks.map((b) => b.refId)));

  const units = assignments.flatMap((a) =>
    chunks.map((chunk, chunkIndex) => ({ assignment: a, chunk, chunkIndex })));

  const findings: RegulatoryFinding[] = [];
  const rawVerbatims: Array<RawVerbatim & { regulationId: string; referenceCode: string }> = [];
  const failures: RegulatoryCheckFailure[] = [];
  const notesByRegulation: Record<string, string> = {};
  let dropped = 0;
  let truncatedResponses = 0;
  let model: string | undefined;
  let done = 0;

  await mapWithConcurrency(units, CONCURRENCY, async (unit) => {
    const referenceCode = unit.assignment.regulation?.referenceCode ?? unit.assignment.regulationId;
    const label = `${referenceCode} — ${chunks.length > 1 ? `part ${unit.chunkIndex + 1}/${chunks.length}` : 'whole template'}`;
    try {
      const res = await callCheck({
        templateId: template.id,
        regulationId: unit.assignment.regulationId,
        document: unit.chunk,
        chunkIndex: unit.chunkIndex,
        chunkCount: chunks.length,
      }, token);

      if (res.model) model = res.model;
      if (res.truncated) truncatedResponses++;

      for (const raw of Array.isArray(res.findings) ? res.findings : []) {
        if (!isRawFinding(raw)) { dropped++; continue; }
        const sectionId = opt(raw.sectionId);
        const refId = opt(raw.refId);
        const section = sectionId ? sectionMeta.get(sectionId) : undefined;
        const anchorClaimed = Boolean(sectionId || refId);
        const anchorResolved = Boolean(section) || (refId ? refIds.has(refId) : false);
        findings.push({
          severity: raw.severity as RegulatoryFinding['severity'],
          kind: (['missing', 'incorrect', 'placement', 'wording', 'excess']
            .includes(raw.kind) ? raw.kind : 'incorrect') as RegulatoryFinding['kind'],
          regulationId: unit.assignment.regulationId,
          regulationReference: referenceCode,
          clause: opt(raw.clause),
          ...(anchorResolved
            ? {
                sectionId: section ? sectionId : undefined,
                sectionPath: section?.path,
                sectionTitle: section?.title,
                refId: refId && refIds.has(refId) ? refId : undefined,
              }
            : { unresolvedAnchor: anchorClaimed ? true : undefined }),
          requirement: raw.requirement,
          issue: raw.issue,
          suggestedChange: typeof raw.suggestedChange === 'string' ? raw.suggestedChange : '',
          quote: opt(raw.quote),
        });
      }

      for (const raw of Array.isArray(res.verbatims) ? res.verbatims : []) {
        if (!isRawVerbatim(raw)) { dropped++; continue; }
        rawVerbatims.push({ ...raw, regulationId: unit.assignment.regulationId, referenceCode });
      }

      const note = opt(res.notes);
      if (note) {
        notesByRegulation[unit.assignment.regulationId] =
          [notesByRegulation[unit.assignment.regulationId], note].filter(Boolean).join('\n');
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(TAG, `unit failed: ${label} — ${message}`);
      failures.push({
        regulationId: unit.assignment.regulationId,
        referenceCode,
        chunkIndex: unit.chunkIndex,
        error: message,
      });
    } finally {
      done++;
      onProgress?.({ done, total: units.length, label });
    }
  });

  // Dedupe verbatims by exact phrase across regulations, keeping the first and
  // collecting every regulation that surfaced it. Verify each once, against the real
  // freeze implementation — this is what gates the register button.
  const verbatims: RegulatoryVerbatim[] = [];
  const byPhrase = new Map<string, RegulatoryVerbatim>();
  for (const raw of rawVerbatims) {
    const phrase = raw.phrase.trim();
    const existing = byPhrase.get(phrase);
    if (existing) {
      if (!existing.regulationIds.includes(raw.regulationId)) {
        existing.regulationIds.push(raw.regulationId);
        existing.regulationReferences.push(raw.referenceCode);
      }
      // 'near' anywhere is the safer reading — it blocks registration.
      if (raw.exactness === 'near') existing.exactness = 'near';
      continue;
    }
    const sectionId = opt(raw.sectionId);
    const section = sectionId ? sectionMeta.get(sectionId) : undefined;
    const entry: RegulatoryVerbatim = {
      phrase,
      clause: opt(raw.clause),
      rationale: typeof raw.rationale === 'string' ? raw.rationale : '',
      exactness: raw.exactness as 'exact' | 'near',
      regulationIds: [raw.regulationId],
      regulationReferences: [raw.referenceCode],
      sectionId: section ? sectionId : undefined,
      sectionPath: section?.path,
      refId: opt(raw.refId) && refIds.has(raw.refId) ? raw.refId : undefined,
      verification: verifyVerbatimPhrase(phrase, sections),
    };
    byPhrase.set(phrase, entry);
    verbatims.push(entry);
  }

  findings.sort((a, b) =>
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    (a.sectionPath ?? '').localeCompare(b.sectionPath ?? ''));

  const status: RegCheckStatus =
    failures.length === 0 ? 'complete'
      : failures.length === units.length ? 'failed'
        : 'partial';

  const report: RegulatoryCheckReport = {
    templateId: template.id,
    templateName: template.name,
    templateType: template.templateType,
    finishedAt: new Date().toISOString(),
    sectionCount: doc.sections.length,
    chunkCount: chunks.length,
    regulations: assignments.map((a) => ({
      id: a.regulationId,
      referenceCode: a.regulation?.referenceCode ?? a.regulationId,
      title: a.regulation?.title ?? '',
      notes: a.notes,
    })),
    findings,
    verbatims,
    notesByRegulation,
    failures,
    dropped,
    truncatedResponses,
    model,
  };

  // One insert, at the end. A 'failed' row explaining "we tried and the model was
  // down" is worth more than silence, and it is one small row.
  const row = await db.insert<Row>('im_regulatory_checks', {
    template_id: template.id,
    status,
    report,
    regulation_count: assignments.length,
    section_count: doc.sections.length,
    finding_count: findings.length,
    verbatim_count: verbatims.length,
    ...(model ? { model } : {}),
    prompt_key: 'im_regulatory_check',
    ...(runBy ? { run_by: runBy } : {}),
  });

  return row ? mapRun(row) : {
    id: '',
    templateId: template.id,
    status,
    report,
    regulationCount: assignments.length,
    sectionCount: doc.sections.length,
    findingCount: findings.length,
    verbatimCount: verbatims.length,
    model,
    promptKey: 'im_regulatory_check',
    runBy,
    createdAt: report.finishedAt,
  };
};

/** Past runs for a template, newest first. The table is append-only, so these are stable. */
export const getRegulatoryCheckHistory = async (
  templateId: string,
  limit = 20,
): Promise<RegulatoryCheckRun[]> => {
  if (!templateId || !isLive) return [];
  const rows = await orEmpty(
    withDeadline(
      (signal) => db.select<Row>('im_regulatory_checks', {
        where: { template_id: templateId },
        order: { column: 'created_at', ascending: false },
        limit,
        signal,
      }),
      READ_TIMEOUT_MS,
      'getRegulatoryCheckHistory',
    ),
    `${TAG} getRegulatoryCheckHistory`,
  );
  return rows.map(mapRun);
};
