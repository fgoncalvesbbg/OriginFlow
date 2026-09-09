/**
 * Getting design spec PDFs in and out of the private bucket.
 *
 * Nothing here talks to Storage directly, and that is the design: `design-specs` is a
 * private bucket with NO policies (migration 163), so neither an anonymous reviewer nor an
 * authenticated designer can read or write it from the browser. Two Netlify Functions hold
 * the service role and are the authorization:
 *
 *   design-spec-file        token or session -> a five-minute signed READ url
 *   design-spec-upload-url  session + design-editor role -> signed WRITE urls
 *
 * The bytes never pass through either function — the browser PUTs and GETs Storage directly
 * with the signed URL. A design spec can be 50MB and a function body cannot.
 */

import { auth } from '../../data';
import { stampDraftPdf, readPageCount } from './design-spec-stamp';
import type { DesignSpecVersionKind } from '../../types/design-spec.types';

/** Mirrors the bucket's file_size_limit, so an oversize file is refused before uploading. */
export const MAX_SPEC_PDF_BYTES = 52428800; // 50 MB

export interface DesignSpecFile {
  url: string;
  expiresIn: number;
  version: number;
  kind: DesignSpecVersionKind;
  specCode: string;
  /** True when the served object is the DRAFT-stamped copy rather than the original. */
  stamped: boolean;
}

/** Read the error the function wrote for this screen, not a generic failure. */
const errorFrom = async (res: Response, fallback: string): Promise<never> => {
  const body = await res.json().catch(() => ({} as { error?: string }));
  throw new Error(body?.error ?? fallback);
};

/**
 * A reviewer's copy, authorized by their review token.
 *
 * `versionId` is passed as well as the token because the function checks the two AGAINST each
 * other — a token for another spec's round must not unlock this file.
 */
export const fetchDesignSpecFileByToken = async (
  token: string,
  versionId: string,
): Promise<DesignSpecFile> => {
  const res = await fetch('/.netlify/functions/design-spec-file', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, versionId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await errorFrom(res, 'This design spec is currently unavailable.');
  return res.json();
};

/** An internal user's copy — the design team's original, not the stamped draft. */
export const fetchDesignSpecFile = async (versionId: string): Promise<DesignSpecFile> => {
  const session = await auth.getSession();
  const res = await fetch('/.netlify/functions/design-spec-file', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
    body: JSON.stringify({ versionId }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await errorFrom(res, 'Could not open that design spec.');
  return res.json();
};

interface SignedSlot { path: string; signedUrl: string }

interface UploadTargets {
  contentType: string;
  original: SignedSlot;
  /** Null for a final version, which is served exactly as uploaded. */
  stamped: SignedSlot | null;
}

const requestUploadTargets = async (
  specId: string,
  kind: DesignSpecVersionKind,
  byteSize: number,
): Promise<UploadTargets> => {
  const session = await auth.getSession();
  const res = await fetch('/.netlify/functions/design-spec-upload-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
    body: JSON.stringify({ specId, kind, byteSize }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) await errorFrom(res, 'Could not prepare the upload.');
  return res.json();
};

/** PUT bytes straight to Storage with a one-shot signed URL. */
const put = async (signedUrl: string, body: BlobPart, contentType: string): Promise<void> => {
  const res = await fetch(signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Blob([body], { type: contentType }),
    // A 50MB upload on a slow connection needs a generous ceiling; the signed URL itself is
    // the thing that expires.
    signal: AbortSignal.timeout(10 * 60_000),
  });
  if (!res.ok) {
    throw new Error(res.status === 413
      ? 'That PDF is larger than the 50MB limit.'
      : 'Uploading the PDF failed. Please try again.');
  }
};

export interface UploadedVersionFiles {
  storagePath: string;
  stampedPath: string | null;
  pageCount: number | null;
  byteSize: number;
}

/**
 * Upload one version's files: the original, and for a draft the DRAFT-stamped copy.
 *
 * THE STAMP IS APPLIED HERE, IN THE BROWSER, before either object is uploaded — the bytes
 * are already in hand, so stamping server-side would mean moving 50MB up, down, and up
 * again. If stamping fails the whole upload fails: uploading an original with no stamped
 * copy would leave a draft whose review link either serves nothing or, worse, would have to
 * fall back to the unmarked original. `design-spec-file` refuses that fallback for the same
 * reason.
 *
 * The original is uploaded LAST. Both objects live under paths the server chose, and the
 * version row is only written by the caller once this resolves, so a failure part-way leaves
 * orphaned objects in the bucket and no row claiming they exist — the harmless direction.
 */
export const uploadDesignSpecVersion = async (
  specId: string,
  file: File,
  kind: DesignSpecVersionKind,
  meta: { specCode: string; version: number; projectLabel: string },
): Promise<UploadedVersionFiles> => {
  if (file.size > MAX_SPEC_PDF_BYTES) {
    throw new Error('That PDF is larger than the 50MB limit.');
  }
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('A design spec must be a PDF.');
  }

  const bytes = await file.arrayBuffer();
  const targets = await requestUploadTargets(specId, kind, file.size);

  // Read before stamping: a file pdf-lib cannot parse should fail here, at pick time, with a
  // message the designer can act on — not silently store an unstampable draft.
  const pageCount = await readPageCount(bytes);

  if (kind === 'draft') {
    if (!targets.stamped) throw new Error('The server did not offer a slot for the review copy.');
    let stamped: Uint8Array;
    try {
      stamped = await stampDraftPdf({
        pdf: bytes,
        specCode: meta.specCode,
        version: meta.version,
        projectLabel: meta.projectLabel,
      });
    } catch (e) {
      console.error('[uploadDesignSpecVersion] stamping failed:', e);
      throw new Error('This PDF could not be marked as a draft, so it was not uploaded. Re-export it and try again.');
    }
    // pdf-lib returns a Uint8Array. A Blob accepts one at runtime, but TypeScript 5.7 made
    // Uint8Array generic over ArrayBufferLike, so the view no longer satisfies BlobPart.
    // Slicing the used region yields a plain ArrayBuffer and copies exactly once.
    const stampedBuffer = stamped.buffer.slice(
      stamped.byteOffset,
      stamped.byteOffset + stamped.byteLength,
    ) as ArrayBuffer;
    await put(targets.stamped.signedUrl, stampedBuffer, targets.contentType);
  }

  await put(targets.original.signedUrl, bytes, targets.contentType);

  return {
    storagePath: targets.original.path,
    stampedPath: targets.stamped?.path ?? null,
    pageCount,
    byteSize: file.size,
  };
};
