/**
 * Supplier IM draft intake — the client half (migration 179).
 *
 * NOTHING HERE TALKS TO STORAGE, and only the internal reads touch Supabase directly. The
 * `im-drafts` bucket is private with no policies and `im_draft_requests`/`im_draft_uploads`
 * are RLS-scoped to can_see_project, so every portal call goes through one Netlify Function
 * (`/api/im-draft/*`) that holds the service role and IS the authorization.
 *
 * The bytes never pass through that function either — the browser PUTs straight to Storage
 * with a signed URL for a path the server chose, then asks the server to validate what
 * landed. A draft manual can be 50MB and a function body cannot.
 *
 * The QM markup round itself needs nothing from this file: it runs on the shared review
 * layer (`src/services/review/`) exactly as the IM and design-spec rounds do, because
 * `review_resolve`, `review_add_comment` and `review_submit` are subject-agnostic.
 */

import { auth, db, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { draftStepOf, type DraftStep } from '../../pages/im/im-manual-status';
import type { IMTemplateType } from '../../types';

const API = '/api/im-draft';

/** Mirrors the bucket's file_size_limit, so an oversize file is refused before uploading. */
export const MAX_DRAFT_PDF_BYTES = 52428800; // 50 MB

/** Read the error the function wrote for this screen, not a generic failure. */
const errorFrom = async (res: Response, fallback: string): Promise<never> => {
  const body = await res.json().catch(() => ({} as { error?: string }));
  throw new Error(body?.error ?? fallback);
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One open draft slot, as the supplier portal sees it. */
export interface SupplierDraftRequest {
  id: string;
  templateType: IMTemplateType;
  requestedAt: string;
  dueDate: string | null;
  note: string | null;
  projectName: string | null;
  projectCode: string | null;
  latestVersion: number | null;
  latestUploadedAt: string | null;
}

/** One draft awaiting Quality's review, as the QM queue sees it. */
export interface QueuedDraft {
  token: string;
  version: number | null;
  projectName: string | null;
  projectCode: string | null;
  pageCount: number | null;
  uploadedAt: string;
  uploadedBy: string;
  filename: string | null;
}

/** An uploaded draft PDF, as an internal screen sees it. */
export interface DraftUpload {
  id: string;
  requestId: string;
  version: number;
  source: 'supplier' | 'quality' | 'internal';
  originalFilename: string | null;
  pageCount: number | null;
  byteSize: number | null;
  uploadedByName: string;
  uploadedAt: string;
  withdrawnAt: string | null;
}

/** A project's draft slot and everything derived from it. */
export interface ProjectDraftState {
  requestId: string | null;
  templateType: IMTemplateType;
  requestedAt: string | null;
  dueDate: string | null;
  cancelledAt: string | null;
  uploads: DraftUpload[];
  /** The newest upload that has not been withdrawn. */
  latest: DraftUpload | null;
  /** Whether Quality has submitted their round on `latest`. */
  submitted: boolean;
  submittedAt: string | null;
  /** Quality's notes on `latest`. */
  noteCount: number;
  /** The derived step — one of the four pre-manual ones. */
  step: DraftStep;
}

const EMPTY: ProjectDraftState = {
  requestId: null, templateType: 'im', requestedAt: null, dueDate: null, cancelledAt: null,
  uploads: [], latest: null, submitted: false, submittedAt: null, noteCount: 0, step: 'backlog',
};

// ---------------------------------------------------------------------------
// Supplier portal (no session — portal credentials in headers)
// ---------------------------------------------------------------------------

/**
 * Portal credentials travel in HEADERS, never in a URL or a body. A token in a URL lands in
 * browser history, proxy logs and the Referer of every outbound link.
 */
export interface PortalCredential {
  projectToken?: string | null;
  supplierToken?: string | null;
  accessCode?: string | null;
}

const portalHeaders = (c: PortalCredential): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...(c.projectToken ? { 'x-portal-token': c.projectToken } : {}),
  ...(c.supplierToken ? { 'x-supplier-token': c.supplierToken } : {}),
  ...(c.accessCode ? { 'x-supplier-code': c.accessCode } : {}),
});

const portalPost = async (
  route: string,
  credential: PortalCredential,
  body: unknown,
  fallback: string,
): Promise<any> => {
  const res = await fetch(`${API}/${route}`, {
    method: 'POST',
    headers: portalHeaders(credential),
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await errorFrom(res, fallback);
  return res.json();
};

/** The open draft slots for the projects this credential speaks for. */
export const getSupplierDraftRequests = async (
  credential: PortalCredential,
): Promise<SupplierDraftRequest[]> => {
  const data = await portalPost('requests', credential, {}, 'Could not load your draft requests.');
  return data.requests ?? [];
};

/**
 * Upload a draft PDF against one request. Three steps, and the middle one is the only place
 * the bytes exist on the wire:
 *
 *   1. ask for a signed URL at a path the SERVER chooses
 *   2. PUT the file straight to Storage
 *   3. ask the server to read it back and validate it
 *
 * Step 3 is what makes a renamed .docx fail: the server checks the `%PDF-` magic on the
 * stored object and deletes it if it is wrong, so a rejected upload cannot linger in the
 * bucket. It also opens Quality's review round and returns the token for it.
 */
export const uploadSupplierDraft = async (
  credential: PortalCredential,
  requestId: string,
  file: File,
  uploadedByName: string,
  onStage?: (stage: 'preparing' | 'uploading' | 'recording') => void,
): Promise<{ uploadId: string; version: number; reviewToken: string }> => {
  if (file.size > MAX_DRAFT_PDF_BYTES) {
    throw new Error('That PDF is larger than the 50MB limit.');
  }

  onStage?.('preparing');
  const prepared = await portalPost(
    'upload-url', credential,
    { requestId, byteSize: file.size },
    'Could not prepare the upload.',
  );

  onStage?.('uploading');
  // `fetch` has no upload-progress event, so the stage callback is coarse by necessity —
  // the same compromise as the SOP registry's createVersion.
  const put = await fetch(prepared.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': prepared.contentType || 'application/pdf' },
    body: file,
  });
  if (!put.ok) throw new Error('The upload did not complete. Please try again.');

  onStage?.('recording');
  return portalPost(
    'commit', credential,
    {
      requestId,
      uploadId: prepared.uploadId,
      uploadedByName,
      originalFilename: file.name,
    },
    'Could not record that upload.',
  );
};

// ---------------------------------------------------------------------------
// The QM queue (no session — one shared access code)
// ---------------------------------------------------------------------------

/**
 * Drafts waiting for Quality, and the token that opens each.
 *
 * The code is checked server-side against a pgcrypto hash and rate-limited per IP before it
 * is even compared, so this call is not a usable guessing oracle. A wrong code and an empty
 * queue are deliberately different: a wrong code throws, so the screen can say so.
 */
export const getQualityDraftQueue = async (code: string): Promise<QueuedDraft[]> => {
  const res = await fetch(`${API}/queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await errorFrom(res, 'Could not open the draft queue.');
  return (await res.json()).drafts ?? [];
};

// ---------------------------------------------------------------------------
// The file itself
// ---------------------------------------------------------------------------

/**
 * A reviewer's copy, authorized by their review token.
 *
 * `uploadId` is passed as well as the token because the function checks the two AGAINST each
 * other — a token for another draft's round, or for a design spec, must not unlock this file.
 */
export const fetchDraftFileByToken = async (
  token: string,
  uploadId: string,
): Promise<{ url: string; expiresIn: number }> => {
  const res = await fetch(`${API}/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, uploadId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await errorFrom(res, 'This draft is currently unavailable.');
  return res.json();
};

/** An internal user's copy. Authorized by their own session, as Postgres sees it. */
export const fetchDraftFile = async (
  uploadId: string,
): Promise<{ url: string; expiresIn: number }> => {
  const session = await auth.getSession();
  const res = await fetch(`${API}/file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
    body: JSON.stringify({ uploadId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await errorFrom(res, 'Could not open that draft.');
  return res.json();
};

// ---------------------------------------------------------------------------
// Internal reads and writes (authenticated; RLS is the boundary)
// ---------------------------------------------------------------------------

const mapUpload = (r: any): DraftUpload => ({
  id: r.id,
  requestId: r.request_id,
  version: r.version,
  source: r.source,
  originalFilename: r.original_filename ?? null,
  pageCount: r.page_count ?? null,
  byteSize: r.byte_size ?? null,
  uploadedByName: r.uploaded_by_name,
  uploadedAt: r.uploaded_at,
  withdrawnAt: r.withdrawn_at ?? null,
});

/**
 * Everything a project's IM screen needs about its draft, in one place — including the
 * derived step, so no caller re-implements the rule from `draftStepOf`.
 */
export const getProjectDraftState = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<ProjectDraftState> => {
  if (!isLive) return EMPTY;

  const request = await db.selectMaybeOne<Row>('im_draft_requests', {
    columns: 'id, template_type, requested_at, due_date, cancelled_at',
    where: { project_id: projectId, template_type: templateType },
  });

  if (!request) return { ...EMPTY, templateType };

  const uploadRows = await db.select<Row>('im_draft_uploads', {
    columns: 'id, request_id, version, source, original_filename, page_count, byte_size, uploaded_by_name, uploaded_at, withdrawn_at',
    where: { request_id: request.id },
    order: { column: 'version', ascending: false },
  });

  const uploads = uploadRows.map(mapUpload);
  const latest = uploads.find(u => !u.withdrawnAt) ?? null;

  // Quality's round on the latest upload. Read from the shared review layer rather than
  // mirrored onto a column, so "submitted" can never disagree with the round itself.
  let submittedAt: string | null = null;
  let noteCount = 0;
  if (latest) {
    const shares = await db.select<Row>('review_shares', {
      columns: 'id, submitted_at',
      where: { subject_type: 'im_draft', subject_id: latest.id },
    });

    submittedAt = shares
      .map(s => s.submitted_at as string | null)
      .filter((v): v is string => !!v)
      .sort()
      .pop() ?? null;

    noteCount = await db.count('review_comments', {
      where: { subject_type: 'im_draft', subject_id: latest.id },
    });
  }

  const r = request;
  return {
    requestId: r.id,
    templateType,
    requestedAt: r.requested_at,
    dueDate: r.due_date ?? null,
    cancelledAt: r.cancelled_at ?? null,
    uploads,
    latest,
    submitted: !!submittedAt,
    submittedAt,
    noteCount,
    step: draftStepOf({
      hasOpenRequest: !r.cancelled_at,
      hasUpload: !!latest,
      draftSubmitted: !!submittedAt,
    }),
  };
};

/**
 * The draft step for many projects at once, for the board.
 *
 * One query per table rather than one round trip per project: the All Manuals board renders
 * every backlog project, and N+1 there is the difference between a board and a stall.
 */
export const getDraftStepsByProject = async (
  templateType: IMTemplateType = 'im',
): Promise<Map<string, { step: DraftStep; requestedAt: string | null; noteCount: number }>> => {
  const out = new Map<string, { step: DraftStep; requestedAt: string | null; noteCount: number }>();
  if (!isLive) return out;

  const requests = await db.select<Row>('im_draft_requests', {
    columns: 'id, project_id, requested_at, cancelled_at',
    where: { template_type: templateType },
  });

  if (!requests.length) return out;

  const requestIds = requests.map(r => r.id as string);
  const uploads = await db.select<Row>('im_draft_uploads', {
    columns: 'id, request_id, version, withdrawn_at',
    where: { request_id: requestIds, withdrawn_at: { op: 'isNull' } },
    order: { column: 'version', ascending: false },
  });

  // The newest live upload per request.
  const latestByRequest = new Map<string, string>();
  for (const u of uploads) {
    if (!latestByRequest.has(u.request_id)) latestByRequest.set(u.request_id, u.id);
  }

  const uploadIds = [...latestByRequest.values()];
  const submitted = new Set<string>();
  const notes = new Map<string, number>();
  if (uploadIds.length) {
    const shares = await db.select<Row>('review_shares', {
      columns: 'subject_id, submitted_at',
      where: { subject_type: 'im_draft', subject_id: uploadIds },
    });
    for (const s of shares) {
      if (s.submitted_at) submitted.add(s.subject_id);
    }

    const comments = await db.select<Row>('review_comments', {
      columns: 'subject_id',
      where: { subject_type: 'im_draft', subject_id: uploadIds },
    });
    for (const c of comments) {
      notes.set(c.subject_id, (notes.get(c.subject_id) ?? 0) + 1);
    }
  }

  for (const r of requests) {
    const uploadId = latestByRequest.get(r.id) ?? null;
    out.set(r.project_id, {
      step: draftStepOf({
        hasOpenRequest: !r.cancelled_at,
        hasUpload: !!uploadId,
        draftSubmitted: !!uploadId && submitted.has(uploadId),
      }),
      requestedAt: r.requested_at ?? null,
      noteCount: uploadId ? (notes.get(uploadId) ?? 0) : 0,
    });
  }
  return out;
};

/** Open (or re-open) the draft slot a supplier uploads into. */
export const requestSupplierDraft = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
  opts: { dueDate?: string | null; note?: string | null; requestedBy?: string | null } = {},
): Promise<void> => {
  if (!isLive) return;
  await db.upsert('im_draft_requests', {
    project_id: projectId,
    template_type: templateType,
    due_date: opts.dueDate ?? null,
    note: opts.note ?? null,
    requested_by: opts.requestedBy ?? null,
    // Re-requesting after a cancel reuses the row, which is why cancelled_at is cleared
    // here rather than left for someone to notice.
    cancelled_at: null,
    requested_at: new Date().toISOString(),
  }, { onConflict: 'project_id,template_type' });
};

/**
 * Stop collecting a draft. The project falls back to plain Backlog and the writer is not
 * blocked — which was never in question, but this is what clears the column.
 *
 * Notes already made survive: a submitted draft still reads as Draft Ready (see
 * `draftStepOf`), because cancelling says "no further draft is coming", not "forget what
 * Quality told us".
 */
export const cancelSupplierDraftRequest = async (
  projectId: string,
  templateType: IMTemplateType = 'im',
): Promise<void> => {
  if (!isLive) return;
  await db.updateWhere('im_draft_requests',
    { cancelled_at: new Date().toISOString() },
    { where: { project_id: projectId, template_type: templateType } });
};

/** Withdraw one uploaded version — a wrong file, or a supplier's mistake. */
export const withdrawDraftUpload = async (uploadId: string): Promise<void> => {
  if (!isLive) return;
  await db.updateWhere('im_draft_uploads',
    { withdrawn_at: new Date().toISOString() },
    { where: { id: uploadId } });
};
