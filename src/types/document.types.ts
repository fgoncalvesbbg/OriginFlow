/**
 * SOP & Documents — the registry for internal SOPs and supplier-facing specs.
 *
 * These types mirror the DTOs in netlify/functions/lib/doc-access.ts, and the mirroring is
 * load-bearing: `SupplierDocumentVersion` has no `sharepointLink` field because the server
 * never sends one, and adding it here to "make the types line up" would be adding a field
 * the supplier-facing code would then try to render.
 *
 * Nothing in src/ ever queries doc_* directly. Those tables are RLS default-deny with the
 * PostgREST grants revoked (migration 159), so a client query would fail anyway — but the
 * reason it is not attempted is that a browser cannot make the entitlement decision. See
 * src/services/documents/.
 */

/** What kind of thing a registered document is. Mirrors doc_documents_doc_type_check. */
export type DocumentType = 'sop' | 'guideline' | 'spec' | 'template' | 'form' | 'checklist';

/**
 * Who a document is for. The most consequential field in the module: 'internal' means no
 * supplier sees any version of it, whatever else is true.
 */
export type DocumentAudience = 'internal' | 'supplier';

export const DOCUMENT_TYPES: readonly DocumentType[] = [
  'sop', 'guideline', 'spec', 'template', 'form', 'checklist',
];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  sop: 'SOP',
  guideline: 'Guideline',
  spec: 'Specification',
  template: 'Template',
  form: 'Form',
  checklist: 'Checklist',
};

/** The registry entry, as an internal user sees it. */
export interface RegisteredDocument {
  id: string;
  title: string;
  docType: DocumentType;
  audience: DocumentAudience;
  ownerUserId: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

/** The headline shown on a registry row: which version is currently released. */
export interface FinalVersionSummary {
  id: string;
  label: string;
  finalizedAt: string | null;
}

export interface RegisteredDocumentRow extends RegisteredDocument {
  finalVersion: FinalVersionSummary | null;
}

/**
 * A version, as an INTERNAL user sees it.
 *
 * `hasPdf` rather than a path: the storage key never leaves the server, for anyone. The
 * bytes are reached through `downloadPath`, which is a route, not a URL to a file.
 */
export interface DocumentVersion {
  id: string;
  documentId: string;
  label: string;
  isFinal: boolean;
  finalizedBy: string | null;
  finalizedAt: string | null;
  sharepointLink: string | null;
  hasPdf: boolean;
  pdfBytes: number | null;
  pdfSha256: string | null;
  supersededBy: string | null;
  uploadedBy: string;
  createdAt: string;
  downloadPath: string;
}

/** One entry in the append-only finalisation history. */
export interface DocumentVersionEvent {
  id: string;
  versionId: string;
  event: 'finalized' | 'unfinalized';
  actorUserId: string | null;
  at: string;
  note: string | null;
}

/**
 * A version as a SUPPLIER sees it. Note what is absent: sharepointLink, isFinal (it is
 * always true or the version would not be here), and anything about the versions they
 * cannot see.
 */
export interface SupplierDocumentVersion {
  id: string;
  documentId: string;
  label: string;
  finalizedAt: string | null;
  pdfBytes: number | null;
  pdfSha256: string | null;
  downloadPath: string;
}

/** A document as a supplier sees it. */
export interface SupplierDocument {
  id: string;
  title: string;
  docType: DocumentType;
  tags: string[];
}

/** One row of the Documents tab, on either side of the wall. */
export interface ProjectDocumentEntry<
  TDocument = SupplierDocument | RegisteredDocument,
  TVersion = SupplierDocumentVersion | DocumentVersion,
> {
  document: TDocument;
  finalVersion: TVersion | null;
  projectIds: string[];
}

export type SupplierProjectDocument = ProjectDocumentEntry<SupplierDocument, SupplierDocumentVersion>;
export type InternalProjectDocument = ProjectDocumentEntry<RegisteredDocument, DocumentVersion>;

/**
 * A registry document a project template hands down (migration 166).
 *
 * Structurally the same row the registry list returns, and deliberately so: the admin
 * linking it needs the same two facts — is it supplier-facing, and has anyone finalised a
 * version — because a link with no released version binds silently on every new project
 * and is invisible to every supplier.
 */
export type TemplateDocumentLink = RegisteredDocumentRow;

/** A document bound to a project, as the admin binding panel lists it. */
export interface DocumentBinding {
  id: string;
  createdBy: string | null;
  createdAt: string;
  document: RegisteredDocument;
}

/** Filters on the admin registry list. All optional; all applied server-side. */
export interface DocumentRegistryFilters {
  type?: DocumentType;
  audience?: DocumentAudience;
  tag?: string;
  q?: string;
}
