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
 * The QM markup round itself is not implemented here: it runs on the shared review layer
 * (`src/services/review/`) exactly as the IM and design-spec rounds do, because
 * `review_resolve`, `review_add_comment` and `review_submit` are subject-agnostic. What this
 * file adds is the draft's own vocabulary over it — the markup URL and `markDraftReviewed`,
 * so an internal screen closes a round the same way the portal does instead of writing its
 * own version of "reviewed".
 */

import { auth, db, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { draftStepOf, type DraftStep } from '../../pages/im/im-manual-status';
import { appUrl, createReviewShare, getReviewShares, submitReview } from '../review';
import type { IMTemplateType, ProjectKind } from '../../types';

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
  /** The project phase this ask belongs to, so the portal renders it in the right one. */
  stepNumber: number;
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
  /** True when this date was set on its own and will not follow the phase date (181). */
  dueDateIsCustom: boolean;
  cancelledAt: string | null;
  /** The project phase the supplier is asked in (migration 180). Default 2. */
  stepNumber: number;
  /** Whether the project has got that far yet. False = not late, just early. */
  reachedStep: boolean;
  uploads: DraftUpload[];
  /** The newest upload that has not been withdrawn. */
  latest: DraftUpload | null;
  /** Whether Quality has submitted their round on `latest`. */
  submitted: boolean;
  submittedAt: string | null;
  /** Quality's notes on `latest`. */
  noteCount: number;
  /**
   * The live markup link for `latest` — the URL Quality opens to pin notes on the PDF.
   *
   * Null when there is no upload, or when every round on it has been revoked or has expired.
   * `markDraftReviewed` mints a fresh one in that case rather than failing: the link is the
   * round, so a round that cannot be opened cannot be submitted either.
   */
  markupUrl: string | null;
  /** The derived step — one of the three pre-manual ones. */
  step: DraftStep;
}

/**
 * What the All Manuals board needs to know about one project's draft — the step, plus the
 * two facts the step alone no longer carries.
 *
 * `submitted` is here because a checked draft IS Backlog since the `draft_ready` step was
 * retired: without it the board cannot tell "nothing started" from "a brief is waiting",
 * and those are the two things a writer picking up the queue most needs to tell apart.
 */
export interface DraftBoardState {
  step: DraftStep;
  requestedAt: string | null;
  noteCount: number;
  /** Quality has been through the latest upload. */
  submitted: boolean;
  /** The latest live upload, so a card can open its markup without another round trip. */
  uploadId: string | null;
}

const EMPTY: ProjectDraftState = {
  requestId: null, templateType: 'im', requestedAt: null, dueDate: null,
  dueDateIsCustom: false, cancelledAt: null,
  stepNumber: 2, reachedStep: false,
  uploads: [], latest: null, submitted: false, submittedAt: null, noteCount: 0,
  markupUrl: null, step: 'backlog',
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
 *
 * No name is asked for. The credential already identifies the company, so the server reads
 * the supplier's name off the project — uploading a draft is the same gesture as uploading
 * any other project document, and none of those ask who you are either.
 */
export const uploadSupplierDraft = async (
  credential: PortalCredential,
  requestId: string,
  file: File,
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
    { requestId, uploadId: prepared.uploadId, originalFilename: file.name },
    'Could not record that upload.',
  );
};

/**
 * Attach a PDF to a re-edit's requirement (migration 182) — a markup, a complaint, a test
 * report, whatever prompted the re-edit.
 *
 * Deliberately the SAME three-step flow and the same two server routes as
 * `uploadSupplierDraft`: only the credential differs (the caller's own session instead of a
 * portal token) and the server records `source: 'internal'` and opens no quality round. A
 * second upload pipeline would mean a second place for the PDF validation to drift.
 */
export const uploadReEditAttachment = async (
  requestId: string,
  file: File,
  onStage?: (stage: 'preparing' | 'uploading' | 'recording') => void,
): Promise<{ uploadId: string; version: number }> => {
  if (file.size > MAX_DRAFT_PDF_BYTES) {
    throw new Error('That PDF is larger than the 50MB limit.');
  }

  const session = await auth.getSession();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
  };
  const post = async (route: string, body: unknown, fallback: string) => {
    const res = await fetch(`${API}/${route}`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) await errorFrom(res, fallback);
    return res.json();
  };

  onStage?.('preparing');
  const prepared = await post('upload-url', { requestId, byteSize: file.size }, 'Could not prepare the upload.');

  onStage?.('uploading');
  const put = await fetch(prepared.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': prepared.contentType || 'application/pdf' },
    body: file,
  });
  if (!put.ok) throw new Error('The upload did not complete. Please try again.');

  onStage?.('recording');
  return post(
    'commit',
    { requestId, uploadId: prepared.uploadId, originalFilename: file.name },
    'Could not record that attachment.',
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
 * The public markup page for a round's token. One place, because the route is also typed
 * into App.tsx and the QM queue, and a third spelling of it is a broken link waiting to
 * happen.
 */
export const draftMarkupUrl = (token: string): string =>
  appUrl(`/review/im-draft/${token}`);

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
    columns: 'id, template_type, requested_at, due_date, due_date_is_custom, cancelled_at, step_number',
    where: { project_id: projectId, template_type: templateType },
  });

  if (!request) return { ...EMPTY, templateType };

  // The phase gate from migration 180: a launch that has not reached the request's step is
  // not late, it is early, and must not read as waiting on the supplier.
  const project = await db.selectMaybeOne<Row>('projects', {
    columns: 'current_step, kind',
    where: { id: projectId },
  });
  const reachedStep = (project?.current_step ?? 1) >= (request.step_number ?? 2);
  const kind = project?.kind === 'reedit' ? 'reedit' : 'launch';

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
  let markupToken: string | null = null;
  if (latest) {
    const shares = await db.select<Row>('review_shares', {
      columns: 'id, token, submitted_at, revoked_at, expires_at, created_at',
      where: { subject_type: 'im_draft', subject_id: latest.id },
      order: { column: 'created_at', ascending: false },
    });

    submittedAt = shares
      .map(s => s.submitted_at as string | null)
      .filter((v): v is string => !!v)
      .sort()
      .pop() ?? null;

    // The newest link that would actually open. A revoked or expired one is not a markup
    // link the screen can offer — showing it would hand Quality a dead URL.
    markupToken = shares.find(s =>
      !s.revoked_at && (!s.expires_at || new Date(s.expires_at as string).getTime() > Date.now()),
    )?.token as string | undefined ?? null;

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
    dueDateIsCustom: r.due_date_is_custom ?? false,
    cancelledAt: r.cancelled_at ?? null,
    stepNumber: r.step_number ?? 2,
    reachedStep,
    uploads,
    latest,
    submitted: !!submittedAt,
    submittedAt,
    noteCount,
    markupUrl: markupToken ? draftMarkupUrl(markupToken) : null,
    step: draftStepOf({
      hasOpenRequest: !r.cancelled_at,
      hasUpload: !!latest,
      draftSubmitted: !!submittedAt,
      reachedStep,
      kind,
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
): Promise<Map<string, DraftBoardState>> => {
  const out = new Map<string, DraftBoardState>();
  if (!isLive) return out;

  const requests = await db.select<Row>('im_draft_requests', {
    columns: 'id, project_id, requested_at, cancelled_at, step_number',
    where: { template_type: templateType },
  });

  if (!requests.length) return out;

  // Every project's current phase, in one read. Since migration 180 every active launch has
  // a request, so this is the gate that decides whether it is WAITING on the supplier or
  // simply has not got there yet — without it the board's first column would hold every
  // project in the system and Backlog would empty out.
  const projectRows = await db.select<Row>('projects', {
    columns: 'id, current_step, kind',
    where: { id: requests.map(r => r.project_id as string) },
  });
  const currentStep = new Map<string, number>(
    projectRows.map(p => [p.id as string, (p.current_step as number) ?? 1]),
  );
  // Re-edits (migration 182) carry their requirement from creation and have no intake. In
  // practice they never get a request row and so never reach this loop at all, but the kind
  // is passed anyway so the rule lives in `draftStepOf` rather than in the absence of data.
  const kindById = new Map<string, ProjectKind>(
    projectRows.map(p => [p.id as string, p.kind === 'reedit' ? 'reedit' : 'launch']),
  );

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
    const draftSubmitted = !!uploadId && submitted.has(uploadId);
    out.set(r.project_id, {
      step: draftStepOf({
        hasOpenRequest: !r.cancelled_at,
        hasUpload: !!uploadId,
        draftSubmitted,
        reachedStep: (currentStep.get(r.project_id) ?? 1) >= ((r.step_number as number) ?? 2),
        kind: kindById.get(r.project_id),
      }),
      requestedAt: r.requested_at ?? null,
      noteCount: uploadId ? (notes.get(uploadId) ?? 0) : 0,
      submitted: draftSubmitted,
      uploadId,
    });
  }
  return out;
};

/**
 * Open a re-edit's requirement slot (migration 182).
 *
 * It writes the SAME `im_draft_requests` row a launch uses, for one reason: that row is what
 * `im_draft_uploads` hangs off, so reusing it gets the attachment pipeline, the PDF viewer
 * and the draft panel for free. What makes it a requirement rather than a supplier ask is
 * `draftStepOf`, which short-circuits on `kind === 'reedit'` and never reads this row as
 * "waiting on the supplier" — plus `step_number: 1`, so even a caller that ignores the kind
 * sees a slot the project has already reached rather than one it is early for.
 */
export const openReEditRequirementSlot = async (
  projectId: string,
  requirement: string,
  requestedBy: string | null,
  templateType: IMTemplateType = 'im',
): Promise<void> => {
  await db.upsert('im_draft_requests', {
    project_id: projectId,
    template_type: templateType,
    step_number: 1,
    note: requirement,
    requested_by: requestedBy,
    requested_at: new Date().toISOString(),
    cancelled_at: null,
  }, { onConflict: 'project_id,template_type' });
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
 * Notes already made survive: a checked draft stays attached to the project (see
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

/**
 * Mark Quality's round on one upload finished — "we have been through this draft".
 *
 * This is the ONE action the Draft Review step offers, and it is what moves the project to
 * Backlog: `draftStepOf` reads the round's `submitted_at`, so the step follows from the
 * round being closed rather than from a flag anyone could set independently of it. Quality
 * pressing Submit in the markup portal takes the identical path (`review_submit`), which is
 * why a draft checked in the portal and one ticked off here cannot end up in different
 * states.
 *
 * `review_submit` is token-authorized and idempotent: the first submission's timestamp
 * stands, so ticking an already-checked draft is a no-op rather than a new round.
 *
 * A DEAD ROUND IS RE-MINTED RATHER THAN REFUSED. The QM link expires after its TTL, and a
 * draft nobody got to in time is exactly the one someone is now ticking off. Minting a fresh
 * link for the same upload is the honest repair — the round is the link.
 */
export const markDraftReviewed = async (
  projectId: string,
  uploadId: string,
  reviewerName: string,
): Promise<void> => {
  if (!isLive) return;
  await submitReview(await liveDraftToken(projectId, uploadId), reviewerName);
};

/**
 * The markup link for one upload, minting a round if none is open.
 *
 * Quality does not log in and OriginFlow sends no email, so the link has to be handed over
 * by whoever is looking at the project — which means an internal screen must be able to
 * produce one on demand, not only read the one the upload happened to create.
 */
export const ensureDraftMarkupLink = async (
  projectId: string,
  uploadId: string,
): Promise<string> => draftMarkupUrl(await liveDraftToken(projectId, uploadId));

/** The newest openable round on an upload, or a fresh one. */
const liveDraftToken = async (projectId: string, uploadId: string): Promise<string> => {
  const subject = { type: 'im_draft' as const, projectId, id: uploadId };
  const live = await getReviewShares(subject, 'review');
  const usable = live.find(s => !s.expiresAt || new Date(s.expiresAt).getTime() > Date.now());
  if (usable) return usable.token;
  return (await createReviewShare(subject, {
    mode: 'review',
    label: 'Quality review — link re-issued',
  })).token;
};

/** Withdraw one uploaded version — a wrong file, or a supplier's mistake. */
export const withdrawDraftUpload = async (uploadId: string): Promise<void> => {
  if (!isLive) return;
  await db.updateWhere('im_draft_uploads',
    { withdrawn_at: new Date().toISOString() },
    { where: { id: uploadId } });
};
