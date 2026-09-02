/**
 * Importing a researched regulation — `OriginFlow Regulation Import v1`.
 *
 * The document is produced by an AI research pass (docs/regulation-import/research-prompt.md)
 * and pasted or dropped into the Regulations section. That provenance is the whole reason
 * this file is as suspicious as it is: a model asked to describe a standard it cannot see will
 * produce a confident, well-formed, WRONG clause number, and a compliance library filled with
 * plausible fiction is worse than an empty one.
 *
 * So the rules here are deliberately unfriendly:
 *
 *  - VALIDATION REFUSES, IT DOES NOT REPAIR. An unknown carrier is an error, not a silently
 *    dropped value: the difference between "IM" and "IM " is invisible in a diff but decides
 *    whether an obligation reaches a manual's checklist.
 *  - EVERY OBLIGATION NEEDS A CLAUSE THAT EXISTS in the same document. A dangling citation is
 *    the signature of an invented one.
 *  - `verbatim` IS NEVER SYNTHESISED. It is mandated wording that a translation must preserve
 *    byte-for-byte; if the researcher could not copy it from a source, it must be absent. The
 *    prompt says so, and `sourceQuoted: false` here is an error rather than a warning.
 *  - IMPORT NEVER EXPIRES A REGULATION. `status: "expired"` blocks every manual and new TCF
 *    request citing it (migration 140). A paste must not be able to do that: the status is
 *    imported as-is for 'active'/'superseded', and an 'expired' document is accepted only when
 *    the caller passes `allowExpiry`, which the dialog gates behind its own confirmation.
 *
 * MERGE SEMANTICS. Matching mirrors the database's own uniqueness so a re-import is a no-op:
 * a regulation by `reference_code` (case/whitespace-insensitive, like uq_regulations_reference_code),
 * a clause by `number` within it, an obligation by exact `text`. Nothing is ever deleted — an
 * import can add and update, never remove, because "the researcher's second pass mentioned
 * fewer obligations" is not evidence that the missing ones stopped existing.
 */

import type {
  CategoryL3,
  ObligationCarrier,
  Regulation,
  RegulationClause,
  RegulationStatus,
} from '../../types';
import { generateUUID } from '../../utils';
import { getComplianceRequirements, saveRequirement } from '../compliance/compliance-requirement.service';
import { CARRIERS } from './obligation-parse';
import {
  createClause, createObligation, getRegulationStructure, updateClause,
} from './regulation-clause.service';
import {
  MAX_SUMMARY_BYTES, createRegulation, summaryByteLength, updateRegulation,
} from './regulation.service';

export const REGULATION_IMPORT_SCHEMA_VERSION = 1;

const CLAUSE_KINDS = ['clause', 'annex', 'article', 'part', 'section'] as const;
const STATUSES: RegulationStatus[] = ['active', 'superseded', 'expired'];
const TIMING_TYPES = ['ETD', 'POST_ETD'] as const;
const REPORT_ORIGINS = ['third_party_mandatory', 'supplier_inhouse'] as const;
/** ISO date, the only shape the DATE columns accept from a paste. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface RegulationImportClause {
  number: string;
  qualifier?: string;
  title?: string;
  kind?: (typeof CLAUSE_KINDS)[number];
  summary?: string;
  tcfDescription?: string;
  amendedIn?: string;
  lastChangedAt?: string;
  sourceAnchor?: string;
}

export interface RegulationImportObligation {
  /** Must match a `clauses[].number` in the same document, or be omitted deliberately. */
  clause?: string;
  text: string;
  verbatim?: string;
  /**
   * Whether `verbatim` was COPIED from a source the researcher actually had. Required
   * whenever `verbatim` is present; `false` is refused.
   */
  sourceQuoted?: boolean;
  carriers?: ObligationCarrier[];
  optionalCarriers?: ObligationCarrier[];
  note?: string;
}

/** A supplier deliverable this regulation implies. Created only into a category the user picks. */
export interface RegulationImportTcfRequirement {
  title: string;
  description: string;
  clause?: string;
  section?: string;
  isMandatory?: boolean;
  timingType?: (typeof TIMING_TYPES)[number];
  timingWeeks?: number;
  testReportOrigin?: (typeof REPORT_ORIGINS)[number];
  selfDeclarationAccepted?: boolean;
}

export interface RegulationImportDoc {
  importSchemaVersion: number;
  regulation: {
    referenceCode: string;
    title: string;
    jurisdiction?: string;
    summary?: string;
    tcfDescription?: string;
    notes?: string;
    version?: string;
    editionYear?: number;
    issuedAt?: string;
    lastAmendedAt?: string;
    sourceUrl?: string;
    celexId?: string;
    status?: RegulationStatus;
    expiredAt?: string;
    expiredReason?: string;
    reviewDueAt?: string;
    /** Category NAMES; resolved against categories_l3 at import, never ids from a paste. */
    applicableCategoryNames?: string[];
  };
  /** The regulatory-only Markdown the AI check reads. Excludes market/competitor research. */
  summaryMd?: string;
  summaryFileName?: string;
  clauses?: RegulationImportClause[];
  obligations?: RegulationImportObligation[];
  tcfRequirements?: RegulationImportTcfRequirement[];
  /** Provenance. Never written to the library; shown in the preview so sources can be judged. */
  research?: {
    sources?: Array<{ title?: string; url?: string; retrievedAt?: string }>;
    unverified?: string[];
    marketNotes?: string;
  };
}

export interface RegulationImportValidation {
  errors: string[];
  warnings: string[];
  doc?: RegulationImportDoc;
}

const isStr = (v: unknown): v is string => typeof v === 'string';
const isNonEmpty = (v: unknown): v is string => isStr(v) && v.trim() !== '';

const checkCarriers = (
  values: unknown,
  where: string,
  errors: string[],
): ObligationCarrier[] | undefined => {
  if (values === undefined) return undefined;
  if (!Array.isArray(values)) { errors.push(`${where} must be an array.`); return undefined; }
  const out: ObligationCarrier[] = [];
  for (const v of values) {
    if (!isStr(v) || !(CARRIERS as readonly string[]).includes(v)) {
      // Refused, not coerced: "IM " and "im" reaching the database as themselves would decide,
      // invisibly, that an obligation never appears on a manual's checklist.
      errors.push(`${where} contains "${String(v)}"; must be one of ${CARRIERS.join(' | ')}.`);
      continue;
    }
    if (!out.includes(v as ObligationCarrier)) out.push(v as ObligationCarrier);
  }
  return out;
};

const checkDate = (value: unknown, where: string, errors: string[]): void => {
  if (value === undefined || value === null || value === '') return;
  if (!isStr(value) || !ISO_DATE.test(value)) errors.push(`${where} must be an ISO date (yyyy-mm-dd).`);
};

/**
 * Validate an import document. Returns every problem at once rather than the first: a
 * researcher fixing one error at a time through a model is a slow, expensive loop.
 */
export const validateRegulationImport = (raw: unknown): RegulationImportValidation => {
  const errors: string[] = [];
  const warnings: string[] = [];

  let obj: any = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); }
    catch (e) { return { errors: [`Not valid JSON: ${e instanceof Error ? e.message : String(e)}`], warnings }; }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { errors: ['Root must be a JSON object.'], warnings };
  }

  if (obj.importSchemaVersion !== REGULATION_IMPORT_SCHEMA_VERSION) {
    errors.push(`importSchemaVersion must be ${REGULATION_IMPORT_SCHEMA_VERSION}.`);
  }

  const reg = obj.regulation;
  if (!reg || typeof reg !== 'object') {
    errors.push('regulation (object) is required.');
  } else {
    if (!isNonEmpty(reg.referenceCode)) errors.push('regulation.referenceCode (string) is required.');
    if (!isNonEmpty(reg.title)) errors.push('regulation.title (string) is required.');
    if (reg.status !== undefined && !STATUSES.includes(reg.status)) {
      errors.push(`regulation.status must be one of ${STATUSES.join(' | ')}.`);
    }
    if (reg.editionYear !== undefined
        && (typeof reg.editionYear !== 'number' || reg.editionYear < 1900 || reg.editionYear > 2200)) {
      errors.push('regulation.editionYear must be a year between 1900 and 2200.');
    }
    checkDate(reg.issuedAt, 'regulation.issuedAt', errors);
    checkDate(reg.lastAmendedAt, 'regulation.lastAmendedAt', errors);
    checkDate(reg.expiredAt, 'regulation.expiredAt', errors);
    checkDate(reg.reviewDueAt, 'regulation.reviewDueAt', errors);
    if (reg.applicableCategoryNames !== undefined
        && (!Array.isArray(reg.applicableCategoryNames) || !reg.applicableCategoryNames.every(isStr))) {
      errors.push('regulation.applicableCategoryNames must be an array of category names.');
    }
    if (!isNonEmpty(reg.sourceUrl)) {
      warnings.push('No regulation.sourceUrl — nobody can check this against the original.');
    }
    if (!isNonEmpty(reg.tcfDescription)) {
      warnings.push('No regulation.tcfDescription — the TCF will show nothing for this regulation.');
    }
  }

  if (obj.summaryMd !== undefined) {
    if (!isStr(obj.summaryMd)) errors.push('summaryMd must be a string.');
    else {
      const bytes = summaryByteLength(obj.summaryMd);
      if (bytes > MAX_SUMMARY_BYTES) {
        errors.push(
          `summaryMd is ${Math.round(bytes / 1024)} kB; the limit is ` +
          `${Math.round(MAX_SUMMARY_BYTES / 1024)} kB. Trim it to the clauses that govern the manual.`,
        );
      }
    }
  } else {
    // The one thing the AI regulatory check reads. Without it a check is refused server-side
    // (HTTP 422), so importing without one produces a regulation that cannot be checked.
    warnings.push('No summaryMd — a regulatory check against this regulation will be refused.');
  }

  const clauseNumbers = new Set<string>();
  if (obj.clauses !== undefined) {
    if (!Array.isArray(obj.clauses)) errors.push('clauses must be an array.');
    else obj.clauses.forEach((c: any, i: number) => {
      const where = `clauses[${i}]`;
      if (!isNonEmpty(c?.number)) { errors.push(`${where}.number (string) is required.`); return; }
      const key = c.number.trim().toLowerCase();
      if (clauseNumbers.has(key)) errors.push(`${where}.number "${c.number}" is duplicated.`);
      clauseNumbers.add(key);
      if (c.kind !== undefined && !(CLAUSE_KINDS as readonly string[]).includes(c.kind)) {
        errors.push(`${where}.kind must be one of ${CLAUSE_KINDS.join(' | ')}.`);
      }
      checkDate(c.lastChangedAt, `${where}.lastChangedAt`, errors);
    });
  }

  if (obj.obligations !== undefined) {
    if (!Array.isArray(obj.obligations)) errors.push('obligations must be an array.');
    else {
      const texts = new Set<string>();
      obj.obligations.forEach((o: any, i: number) => {
        const where = `obligations[${i}]`;
        if (!isNonEmpty(o?.text)) { errors.push(`${where}.text (string) is required.`); return; }
        const key = o.text.trim().toLowerCase();
        if (texts.has(key)) warnings.push(`${where}.text duplicates an earlier obligation; only one will be created.`);
        texts.add(key);

        if (o.clause !== undefined) {
          if (!isNonEmpty(o.clause)) errors.push(`${where}.clause must be a non-empty string when present.`);
          // A citation naming a clause the document never defines is the signature of an
          // invented one, so it fails the import rather than arriving as an orphan.
          else if (!clauseNumbers.has(o.clause.trim().toLowerCase())) {
            errors.push(`${where}.clause "${o.clause}" is not defined in clauses[].`);
          }
        } else {
          warnings.push(`${where} has no clause; it will not group under any chapter.`);
        }

        checkCarriers(o.carriers, `${where}.carriers`, errors);
        checkCarriers(o.optionalCarriers, `${where}.optionalCarriers`, errors);

        if (o.verbatim !== undefined) {
          if (!isNonEmpty(o.verbatim)) {
            errors.push(`${where}.verbatim must be a non-empty string when present.`);
          } else if (o.sourceQuoted !== true) {
            // The hard rule. This text is what a translation must preserve byte-for-byte;
            // wording a model composed rather than copied is worse than no wording at all.
            errors.push(
              `${where}.verbatim is present but sourceQuoted is not true. Mandated wording must be ` +
              `COPIED from a source, never composed — omit it if it could not be quoted.`,
            );
          }
        }
      });
    }
  }

  if (obj.tcfRequirements !== undefined) {
    if (!Array.isArray(obj.tcfRequirements)) errors.push('tcfRequirements must be an array.');
    else obj.tcfRequirements.forEach((r: any, i: number) => {
      const where = `tcfRequirements[${i}]`;
      if (!isNonEmpty(r?.title)) errors.push(`${where}.title (string) is required.`);
      if (!isNonEmpty(r?.description)) errors.push(`${where}.description (string) is required.`);
      if (r.timingType !== undefined && !(TIMING_TYPES as readonly string[]).includes(r.timingType)) {
        errors.push(`${where}.timingType must be one of ${TIMING_TYPES.join(' | ')}.`);
      }
      if (r.testReportOrigin !== undefined && !(REPORT_ORIGINS as readonly string[]).includes(r.testReportOrigin)) {
        errors.push(`${where}.testReportOrigin must be one of ${REPORT_ORIGINS.join(' | ')}.`);
      }
      if (r.clause !== undefined && isNonEmpty(r.clause) && !clauseNumbers.has(r.clause.trim().toLowerCase())) {
        errors.push(`${where}.clause "${r.clause}" is not defined in clauses[].`);
      }
    });
  }

  if (Array.isArray(obj.research?.unverified) && obj.research.unverified.length > 0) {
    warnings.push(
      `The researcher flagged ${obj.research.unverified.length} item(s) it could not verify. ` +
      `Read research.unverified before trusting this import.`,
    );
  }

  return errors.length ? { errors, warnings } : { errors, warnings, doc: obj as RegulationImportDoc };
};

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface RegulationImportPlan {
  /** The matched library row, when this reference code already exists. */
  existing?: Regulation;
  /** 'create' or 'update' — never 'replace'; nothing is deleted by an import. */
  action: 'create' | 'update';
  /** Field-level changes an update would make, for the preview. */
  fieldChanges: Array<{ field: string; from: string; to: string }>;
  newClauses: string[];
  updatedClauses: string[];
  newObligations: number;
  existingObligations: number;
  /** Category names in the document that match no categories_l3 row. */
  unmatchedCategories: string[];
  matchedCategoryIds: string[];
  /** True when applying this would set status to 'expired' and start blocking work. */
  wouldExpire: boolean;
}

const norm = (v: string | null | undefined): string => (v ?? '').trim().toLowerCase();

/** Find the library row this document refers to, matching the database's own uniqueness rule. */
export const findExistingRegulation = (
  doc: RegulationImportDoc,
  library: Regulation[],
): Regulation | undefined =>
  library.find(r => norm(r.referenceCode) === norm(doc.regulation.referenceCode));

/**
 * Work out what applying the document would do, WITHOUT doing it.
 *
 * Separate from `applyRegulationImport` so the dialog can show a real diff. An import that
 * silently overwrote a curated summary with a model's paraphrase is the failure this prevents.
 */
export const planRegulationImport = (
  doc: RegulationImportDoc,
  library: Regulation[],
  categories: CategoryL3[],
): RegulationImportPlan => {
  const existing = findExistingRegulation(doc, library);
  const r = doc.regulation;

  const fieldChanges: Array<{ field: string; from: string; to: string }> = [];
  if (existing) {
    const compare = (field: string, from: unknown, to: unknown) => {
      if (to === undefined || to === null || to === '') return;
      const a = String(from ?? '');
      const b = String(to);
      if (a !== b) fieldChanges.push({ field, from: a, to: b });
    };
    compare('title', existing.title, r.title);
    compare('jurisdiction', existing.jurisdiction, r.jurisdiction);
    compare('summary', existing.summary, r.summary);
    compare('tcfDescription', existing.tcfDescription, r.tcfDescription);
    compare('notes', existing.notes, r.notes);
    compare('version', existing.version, r.version);
    compare('editionYear', existing.editionYear, r.editionYear);
    compare('issuedAt', existing.issuedAt, r.issuedAt);
    compare('lastAmendedAt', existing.lastAmendedAt, r.lastAmendedAt);
    compare('sourceUrl', existing.sourceUrl, r.sourceUrl);
    compare('celexId', existing.celexId, r.celexId);
    compare('status', existing.status, r.status);
    compare('reviewDueAt', existing.reviewDueAt, r.reviewDueAt);
    if (doc.summaryMd && doc.summaryMd !== existing.summaryMd) {
      fieldChanges.push({
        field: 'summaryMd',
        from: existing.summaryBytes ? `${Math.round(existing.summaryBytes / 1024)} kB` : '(none)',
        to: `${Math.round(summaryByteLength(doc.summaryMd) / 1024)} kB`,
      });
    }
  }

  const existingClauses = new Map((existing?.clauses ?? []).map(c => [norm(c.number), c]));
  const newClauses: string[] = [];
  const updatedClauses: string[] = [];
  for (const c of doc.clauses ?? []) {
    if (existingClauses.has(norm(c.number))) updatedClauses.push(c.number);
    else newClauses.push(c.number);
  }

  const existingTexts = new Set((existing?.obligations ?? []).map(o => norm(o.text)));
  let newObligations = 0;
  let existingObligationCount = 0;
  for (const o of doc.obligations ?? []) {
    if (existingTexts.has(norm(o.text))) existingObligationCount++;
    else newObligations++;
  }

  const matchedCategoryIds: string[] = [];
  const unmatchedCategories: string[] = [];
  for (const name of r.applicableCategoryNames ?? []) {
    const match = categories.find(c => norm(c.name) === norm(name));
    if (match) matchedCategoryIds.push(match.id);
    else unmatchedCategories.push(name);
  }

  return {
    existing,
    action: existing ? 'update' : 'create',
    fieldChanges,
    newClauses,
    updatedClauses,
    newObligations,
    existingObligations: existingObligationCount,
    unmatchedCategories,
    matchedCategoryIds,
    wouldExpire: r.status === 'expired' && existing?.status !== 'expired',
  };
};

/** Turn the document's regulation block into the service's input shape. */
export const toRegulationInput = (
  doc: RegulationImportDoc,
  plan: RegulationImportPlan,
  allowExpiry: boolean,
) => {
  const r = doc.regulation;
  // An import that could expire a regulation could stop every manual citing it with one
  // paste. The status is downgraded to 'active' unless the caller has explicitly confirmed.
  const status: RegulationStatus | undefined = r.status === 'expired' && !allowExpiry
    ? undefined
    : r.status;

  return {
    referenceCode: r.referenceCode.trim(),
    title: r.title.trim(),
    jurisdiction: r.jurisdiction,
    summary: r.summary,
    tcfDescription: r.tcfDescription,
    notes: r.notes,
    version: r.version,
    editionYear: r.editionYear,
    issuedAt: r.issuedAt,
    lastAmendedAt: r.lastAmendedAt,
    sourceUrl: r.sourceUrl,
    celexId: r.celexId,
    reviewDueAt: r.reviewDueAt,
    ...(status ? { status } : {}),
    ...(status === 'expired' ? { expiredAt: r.expiredAt, expiredReason: r.expiredReason } : {}),
    // Merged, never replaced: an import must not silently un-apply a regulation from a
    // category somebody ticked by hand.
    applicableCategories: Array.from(new Set([
      ...(plan.existing?.applicableCategories ?? []),
      ...plan.matchedCategoryIds,
    ])),
    ...(doc.summaryMd ? { summaryMd: doc.summaryMd, summaryFileName: doc.summaryFileName ?? 'summary.md' } : {}),
  };
};

/** Which clauses/obligations still need writing, given what is already stored. */
export const diffStructure = (
  doc: RegulationImportDoc,
  existingClauses: RegulationClause[],
  existingObligationTexts: string[],
) => {
  const byNumber = new Map(existingClauses.map(c => [norm(c.number), c]));
  const texts = new Set(existingObligationTexts.map(norm));
  return {
    clausesToCreate: (doc.clauses ?? []).filter(c => !byNumber.has(norm(c.number))),
    clausesToUpdate: (doc.clauses ?? [])
      .map(c => ({ clause: c, existing: byNumber.get(norm(c.number)) }))
      .filter((x): x is { clause: RegulationImportClause; existing: RegulationClause } => !!x.existing),
    obligationsToCreate: (doc.obligations ?? []).filter(o => !texts.has(norm(o.text))),
  };
};

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

export interface RegulationImportResult {
  regulationId: string;
  action: 'create' | 'update';
  clausesCreated: number;
  clausesUpdated: number;
  obligationsCreated: number;
  tcfRequirementsCreated: number;
  /** Non-fatal problems: the import got this far and then something specific failed. */
  problems: string[];
}

export interface ApplyOptions {
  /** Required before a document with `status: "expired"` is allowed to expire the row. */
  allowExpiry?: boolean;
  /** When set, `tcfRequirements[]` are created as requirements for this category. */
  tcfCategoryId?: string | null;
  actor?: string;
}

/**
 * Write the document.
 *
 * Sequential rather than parallel on purpose: obligations reference clauses that may have just
 * been created, and a partial failure should leave a readable prefix rather than a scatter of
 * half-written rows. Individual failures are collected into `problems` instead of aborting, so
 * one bad obligation does not discard forty good ones.
 */
export const applyRegulationImport = async (
  doc: RegulationImportDoc,
  plan: RegulationImportPlan,
  options: ApplyOptions = {},
): Promise<RegulationImportResult> => {
  const { allowExpiry = false, tcfCategoryId = null, actor } = options;
  const problems: string[] = [];

  const input = toRegulationInput(doc, plan, allowExpiry);
  if (doc.regulation.status === 'expired' && !allowExpiry) {
    problems.push(
      'The document marks this regulation expired. That was NOT applied — expiry blocks every ' +
      'manual and new TCF request citing it, so it must be set deliberately in the editor.',
    );
  }

  const regulationId = plan.existing
    ? (await updateRegulation(plan.existing.id, input, actor), plan.existing.id)
    : (await createRegulation(input, actor)).id;

  // Re-read rather than trusting the plan: another tab may have added a clause since the
  // preview was built, and creating a duplicate would fail the unique index mid-import.
  const structure = await getRegulationStructure(regulationId);
  const { clausesToCreate, clausesToUpdate, obligationsToCreate } = diffStructure(
    doc, structure.clauses, structure.obligations.map(o => o.text),
  );

  let clausesCreated = 0;
  let clausesUpdated = 0;
  for (const c of clausesToCreate) {
    try {
      await createClause(regulationId, {
        number: c.number, qualifier: c.qualifier, title: c.title, kind: c.kind,
        summary: c.summary, tcfDescription: c.tcfDescription,
        amendedIn: c.amendedIn, lastChangedAt: c.lastChangedAt, sourceAnchor: c.sourceAnchor,
      }, actor);
      clausesCreated++;
    } catch (e) {
      problems.push(`Clause "${c.number}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  for (const { clause, existing } of clausesToUpdate) {
    try {
      await updateClause(existing.id, {
        qualifier: clause.qualifier, title: clause.title, kind: clause.kind,
        summary: clause.summary, tcfDescription: clause.tcfDescription,
        amendedIn: clause.amendedIn, lastChangedAt: clause.lastChangedAt,
        sourceAnchor: clause.sourceAnchor,
      });
      clausesUpdated++;
    } catch (e) {
      problems.push(`Clause "${clause.number}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Re-read again so obligations can resolve clauses created a moment ago.
  const afterClauses = await getRegulationStructure(regulationId);
  const clauseIdByNumber = new Map(afterClauses.clauses.map(c => [norm(c.number), c.id]));

  let obligationsCreated = 0;
  let sortOrder = afterClauses.obligations.length;
  for (const o of obligationsToCreate) {
    try {
      await createObligation(regulationId, {
        clauseId: o.clause ? clauseIdByNumber.get(norm(o.clause)) ?? null : null,
        text: o.text,
        verbatim: o.verbatim ?? null,
        carriers: o.carriers ?? [],
        optionalCarriers: o.optionalCarriers ?? [],
        note: o.note ?? null,
        sortOrder: sortOrder++,
      }, actor);
      obligationsCreated++;
    } catch (e) {
      problems.push(`Obligation "${o.text.slice(0, 60)}…": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // TCF requirements are per CATEGORY, so they are only created when the operator picked one.
  // Skipping silently would be wrong; the dialog says the count it will create.
  let tcfRequirementsCreated = 0;
  if (tcfCategoryId && doc.tcfRequirements?.length) {
    const existingRequirements = await getComplianceRequirements();
    const already = new Set(existingRequirements
      .filter(r => r.categoryId === tcfCategoryId)
      .map(r => norm(r.title)));
    for (const req of doc.tcfRequirements) {
      if (already.has(norm(req.title))) continue;
      try {
        await saveRequirement({
          id: generateUUID(),
          categoryId: tcfCategoryId,
          section: req.section,
          title: req.title,
          description: req.description,
          isMandatory: req.isMandatory ?? true,
          regulationId,
          clauseId: req.clause ? clauseIdByNumber.get(norm(req.clause)) ?? null : null,
          appliesByDefault: true,
          condition: null,
          timingType: req.timingType ?? 'ETD',
          timingWeeks: req.timingWeeks ?? 0,
          testReportOrigin: req.testReportOrigin ?? 'third_party_mandatory',
          selfDeclarationAccepted: req.selfDeclarationAccepted ?? false,
        });
        tcfRequirementsCreated++;
      } catch (e) {
        problems.push(`TCF requirement "${req.title}": ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  return {
    regulationId,
    action: plan.action,
    clausesCreated,
    clausesUpdated,
    obligationsCreated,
    tcfRequirementsCreated,
    problems,
  };
};
