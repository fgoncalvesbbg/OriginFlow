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

export type RegulationStatus = 'active' | 'superseded';

export interface Regulation {
  id: string;
  title: string;
  /** Official citation, e.g. "(EU) 2019/2016" or "EN 60335-2-24". Unique (case/space-insensitive). */
  referenceCode: string;
  jurisdiction?: string;
  notes?: string;
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
  /** categories_l3 ids as TEXT. A picker hint only — never used to decide what is checked. */
  applicableCategories: string[];
  status: RegulationStatus;
  supersededById?: string | null;
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
  /** Pass a string to replace the summary, `null` to clear it, omit to leave it alone. */
  summaryMd?: string | null;
  summaryFileName?: string | null;
  applicableCategories?: string[];
  status?: RegulationStatus;
  supersededById?: string | null;
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
