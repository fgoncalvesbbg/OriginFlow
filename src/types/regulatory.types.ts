/**
 * Regulatory types — the regulation library, per-template assignment, and the
 * AI regulatory-check report (migration 115).
 *
 * A `Regulation` describes one regulation or regulatory guideline plus an
 * operator-uploaded Markdown summary. An `im_template_regulations` row assigns one
 * to one IM template (a category + template type), optionally narrowing its scope
 * with a note that is fed to the model. A check run audits the template's ENGLISH
 * content against every assigned regulation and stores an immutable report.
 *
 * The wire/serialization shapes the check sends to the server live next to the
 * code that builds them (src/services/regulatory/regulatory-serialize.ts), the same
 * split `TemplateReviewExport` uses.
 */

import type { IMTemplateType } from './im.types';

/**
 * A regulation's lifecycle (migration 140).
 *  - 'active'     — in force. Applies, stops nothing.
 *  - 'superseded' — retired on purpose. Hidden from the assignment picker; existing uses keep
 *                   working. Has never blocked anything, and still does not.
 *  - 'expired'    — no longer valid. BLOCKS every IM publish and new TCF request that answers
 *                   for it, until `supersededById` names a replacement still in force.
 * See src/services/regulatory/regulation-lifecycle.ts for the resolution rules.
 */
export type RegulationStatus = 'active' | 'superseded' | 'expired';

/**
 * Result of the last automated version check (migration 139).
 *  - 'current'         — nothing newer than what we record.
 *  - 'newer_available' — a consolidated version or amendment postdates our row.
 *  - 'repealed'        — the act's end-of-validity has passed.
 *  - 'not_found'       — the CELEX resolved to nothing. Usually a wrong CELEX.
 *  - 'error'           — the source could not be reached. NOT the same as 'current'.
 * Advisory only: nothing in the app blocks on it, because a stale badge must never
 * stop a manual being published.
 */
export type RegulationVersionState =
  | 'current' | 'newer_available' | 'repealed' | 'not_found' | 'error';

/** What the last EUR-Lex lookup actually found, kept so the UI can justify its badge. */
export interface RegulationVersionDetail {
  source: 'eurlex';
  celex?: string;
  /** e.g. "02014L0035-20260530". */
  latestConsolidated?: string;
  /** The date embedded in the consolidated CELEX, as ISO yyyy-mm-dd. */
  latestConsolidatedOn?: string;
  documentDate?: string;
  amendments?: number;
  lastAmendedOn?: string;
  /** '9999-12-31' means "no end of validity", i.e. still in force. */
  endOfValidity?: string;
}

/** Which artifact must carry an obligation (migration 141). */
export type ObligationCarrier = 'IM' | 'Product' | 'Rating label' | 'Sales packaging';

export type ClauseKind = 'clause' | 'annex' | 'article' | 'part' | 'section';

/**
 * One chapter/clause/annex of a regulation (migration 141).
 *
 * Exists because amendments, obligations and TCF evidence all attach HERE, not to the whole
 * document: 89 of RoHS's amendments touch Annex II/III, so a change date on the parent
 * answers nothing useful.
 *
 * Deliberately has no `status`: expiry stays a regulation-level decision so the publish gate
 * resolves one blocking rule rather than two interacting ones. A changed clause is a prompt
 * to re-verify, not a stop.
 */
export interface RegulationClause {
  id: string;
  regulationId: string;
  /** The citation as written: "7.12.5", "Annex II & III". */
  number: string;
  /** A word following the number in a particular standard, e.g. "Addition". */
  qualifier?: string;
  title?: string;
  kind: ClauseKind;
  /** Zero-padded segments, so 7.2 sorts after 7.12. Maintained by the service. */
  sortKey: string;
  summary?: string;
  tcfDescription?: string;
  /** The amendment that last changed THIS clause, e.g. "A11:2020". */
  amendedIn?: string;
  lastChangedAt?: string | null;
  sourceAnchor?: string;
  createdAt: string;
  updatedAt: string;
}

/** One thing that must be done — a line of the old `checklist` blob, given structure. */
export interface RegulationObligation {
  id: string;
  regulationId: string;
  /** Null when the source line never named a clause. Still a real obligation. */
  clauseId?: string | null;
  text: string;
  /** Wording that must appear word-for-word, when the source quoted some. */
  verbatim?: string;
  /**
   * Artifacts that must carry this. AN EMPTY ARRAY MEANS "NOT CLASSIFIED", NOT "NONE" —
   * the IM checklist shows an unclassified obligation rather than hiding it.
   */
  carriers: ObligationCarrier[];
  optionalCarriers: ObligationCarrier[];
  sortOrder: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** The writable subset of a clause. */
export interface RegulationClauseInput {
  number: string;
  qualifier?: string | null;
  title?: string | null;
  kind?: ClauseKind;
  summary?: string | null;
  tcfDescription?: string | null;
  amendedIn?: string | null;
  lastChangedAt?: string | null;
  sourceAnchor?: string | null;
}

/** The writable subset of an obligation. */
export interface RegulationObligationInput {
  clauseId?: string | null;
  text: string;
  verbatim?: string | null;
  carriers?: ObligationCarrier[];
  optionalCarriers?: ObligationCarrier[];
  sortOrder?: number;
  note?: string | null;
}

/** A regulation with its clauses and obligations stitched in. */
export interface RegulationStructure {
  clauses: RegulationClause[];
  obligations: RegulationObligation[];
}

export interface Regulation {
  id: string;
  title: string;
  /** Official citation, e.g. "(EU) 2019/2016" or "EN 60335-2-24". Unique (case/space-insensitive). */
  referenceCode: string;
  jurisdiction?: string;
  notes?: string;
  /**
   * Short plain-language summary — what this regulation is for, for a PERSON scanning the
   * library (migration 139). Distinct from `summaryMd`, which is the long clause-level text
   * the AI check consumes and nobody reads end to end. Never sent to the model.
   */
  summary?: string;
  /**
   * What this regulation obliges on the TECHNICAL COMPLIANCE FILE — the evidence a supplier
   * has to provide (migration 139). Shown on the internal TCF surfaces, and used to prefill
   * a new requirement's description when one is created from this regulation. It is NOT
   * read live by the supplier portal, so editing it never rewrites a request in flight.
   */
  tcfDescription?: string;
  /**
   * Pre-publish checklist items, one per line — obligations a PERSON verifies by hand
   * (migration 119). These ARE the "IM requirements": every regulation applying to a
   * template contributes its items to one combined checklist shown before a manual is
   * published. Present on list rows, unlike `summaryMd`. NEVER sent to the AI check:
   * unlike `notes` it describes what the check structurally cannot see.
   */
  checklist?: string;
  // --- Version identity (migration 139) ------------------------------------
  /** Edition/amendment as CITED, e.g. "Ed. 6.1", "A11:2020", "consolidated 2026-05-30". */
  version?: string;
  /** Year alone, because half these documents are cited by year ("EN IEC 60335-1:2021"). */
  editionYear?: number | null;
  /** Date of the document itself (ISO yyyy-mm-dd). */
  issuedAt?: string | null;
  /** Date of the most recent amendment we know of — what the version check compares to. */
  lastAmendedAt?: string | null;
  sourceUrl?: string;
  /** EUR-Lex CELEX, e.g. "32014L0035". Only EU acts have one; EN/IEC/ISO do not. */
  celexId?: string;
  versionState?: RegulationVersionState | null;
  versionCheckedAt?: string | null;
  versionDetail?: RegulationVersionDetail | null;
  /** When a PERSON should re-verify against the source — the only signal for EN/IEC/ISO. */
  reviewDueAt?: string | null;
  /**
   * The uploaded Markdown summary — the ONLY thing the AI check is told about the
   * regulation. UNDEFINED on rows returned by `getRegulations()`, which excludes the
   * column so opening the library does not download every summary. Use
   * `getRegulationById()` when the text itself is needed.
   */
  summaryMd?: string;
  summaryFileName?: string;
  /** octet_length of summaryMd at write time. Always present, so list rows can show a size. */
  summaryBytes: number;
  summaryUploadedAt?: string;
  summaryUploadedBy?: string;
  /**
   * categories_l3 ids as TEXT. LOAD-BEARING since migration 116, not a hint: an active
   * regulation listing a category applies to every IM template in that category, and a
   * check there includes it.
   */
  applicableCategories: string[];
  status: RegulationStatus;
  /**
   * The regulation that replaces this one. Decorative for 'superseded'; LOAD-BEARING for
   * 'expired' — it is the single edit that lifts the block, and the chain is followed
   * transitively (migration 140).
   */
  supersededById?: string | null;
  /** When it stopped being valid. Named in every block message. */
  expiredAt?: string | null;
  /** Why, in one line — e.g. "repealed by ESPR (EU) 2024/1781". */
  expiredReason?: string;
  /**
   * Clauses and obligations, attached by `getRegulations()` / `getRegulationById()`
   * (migration 141). Undefined only if the structure read failed — an empty array means the
   * regulation genuinely has none, and the checklist then falls back to parsing `checklist`.
   */
  clauses?: RegulationClause[];
  obligations?: RegulationObligation[];
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

/** The writable subset of a regulation. */
export interface RegulationInput {
  title: string;
  referenceCode: string;
  jurisdiction?: string;
  notes?: string;
  /** Short plain-language summary. Empty/`null` clears it, omit to leave it alone. */
  summary?: string | null;
  /** TCF obligation text. Empty/`null` clears it, omit to leave it alone. */
  tcfDescription?: string | null;
  /** One checklist item per line. Empty/`null` clears the checklist, omit to leave it alone. */
  checklist?: string | null;
  /** Pass a string to replace the summary, `null` to clear it, omit to leave it alone. */
  summaryMd?: string | null;
  summaryFileName?: string | null;
  applicableCategories?: string[];
  status?: RegulationStatus;
  supersededById?: string | null;
  expiredAt?: string | null;
  expiredReason?: string | null;
  version?: string | null;
  editionYear?: number | null;
  issuedAt?: string | null;
  lastAmendedAt?: string | null;
  sourceUrl?: string | null;
  celexId?: string | null;
  reviewDueAt?: string | null;
}

/**
 * One regulation's version-check outcome, as the Netlify function returns it. Written
 * back onto the row by `runVersionCheck` so the library can badge without a round trip.
 */
export interface RegulationVersionResult {
  regulationId: string;
  celex: string;
  state: RegulationVersionState;
  detail: RegulationVersionDetail;
  /** Filled in from EUR-Lex when our row had no `issuedAt` — offered, never auto-applied. */
  suggestedIssuedAt?: string;
  suggestedLastAmendedAt?: string;
  suggestedVersion?: string;
}

/**
 * Where a template's obligation to a regulation comes from.
 *  - 'explicit' — a real `im_template_regulations` row, assigned to THIS template.
 *  - 'category' — derived at read time because the regulation is marked for the
 *    template's category. No row exists, so it carries no scope note and cannot be
 *    unassigned here (unmark the category, or add a note to materialize it).
 */
export type TemplateRegulationSource = 'explicit' | 'category';

/** One regulation a template must satisfy, with its library row stitched in. */
export interface TemplateRegulation {
  /**
   * The `im_template_regulations` row id for an explicit entry, or the synthetic
   * `derived:<regulationId>` for a category one — never treat that as a database key.
   */
  id: string;
  templateId: string;
  regulationId: string;
  /**
   * Scope note for THIS template. Interpolated into the check prompt — functional, not
   * decorative. Only an explicit assignment can carry one.
   */
  notes?: string;
  assignedBy?: string;
  createdAt: string;
  source: TemplateRegulationSource;
  /** Undefined only if the library row vanished between reads. */
  regulation?: Regulation;
}

// ---------------------------------------------------------------------------
// Check report
// ---------------------------------------------------------------------------

export type RegCheckSeverity = 'critical' | 'major' | 'minor' | 'info';
export type RegCheckFindingKind = 'missing' | 'incorrect' | 'placement' | 'wording' | 'excess';
export type RegCheckStatus = 'complete' | 'partial' | 'failed';

/** Whether freezing this phrase would actually protect it at translate time. */
export type VerbatimVerification = 'exact' | 'stripped-only' | 'absent';

export interface RegulatoryFinding {
  severity: RegCheckSeverity;
  kind: RegCheckFindingKind;
  regulationId: string;
  regulationReference: string;
  /** The clause/annex the requirement comes from, as the model cited it. */
  clause?: string;
  sectionId?: string;
  /** Outline number, e.g. "3.2" — for display; lookups use sectionId. */
  sectionPath?: string;
  sectionTitle?: string;
  refId?: string;
  requirement: string;
  issue: string;
  suggestedChange: string;
  /** Copied verbatim from the template text by the model. */
  quote?: string;
  /** The model named a section/ref id that is not in the serialized template. */
  unresolvedAnchor?: boolean;
}

export interface RegulatoryVerbatim {
  /** The template's CURRENT wording, copied verbatim. */
  phrase: string;
  clause?: string;
  rationale: string;
  /** 'near' means the template wording is close to but not identical with the mandated wording. */
  exactness: 'exact' | 'near';
  /** Every regulation whose check surfaced this phrase (deduped by exact phrase). */
  regulationIds: string[];
  regulationReferences: string[];
  sectionId?: string;
  sectionPath?: string;
  refId?: string;
  /** From verifyVerbatimPhrase — only 'exact' can be registered. */
  verification: VerbatimVerification;
}

export interface RegulatoryCheckFailure {
  regulationId: string;
  referenceCode: string;
  chunkIndex: number;
  error: string;
}

export interface RegulatoryCheckReport {
  templateId: string;
  templateName: string;
  templateType: IMTemplateType;
  finishedAt: string;
  sectionCount: number;
  chunkCount: number;
  regulations: Array<{ id: string; referenceCode: string; title: string; notes?: string }>;
  findings: RegulatoryFinding[];
  verbatims: RegulatoryVerbatim[];
  /** Free-text observation per regulation id, when the model returned one. */
  notesByRegulation: Record<string, string>;
  failures: RegulatoryCheckFailure[];
  /** Items dropped because they failed the shape guards. */
  dropped: number;
  /** Calls that hit max_tokens, so their findings may be incomplete. */
  truncatedResponses: number;
  model?: string;
}

/** One stored `im_regulatory_checks` row. */
export interface RegulatoryCheckRun {
  id: string;
  templateId: string;
  status: RegCheckStatus;
  report: RegulatoryCheckReport;
  regulationCount: number;
  sectionCount: number;
  findingCount: number;
  verbatimCount: number;
  model?: string;
  promptKey?: string;
  runBy?: string;
  createdAt: string;
}
