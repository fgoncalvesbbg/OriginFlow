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
import { stampReviewPdf, readPageCount } from './design-spec-stamp';
import type { DesignSpecStage } from '../../types/design-spec.types';

/** Mirrors the bucket's file_size_limit, so an oversize file is refused before uploading. */
export const MAX_SPEC_PDF_BYTES = 52428800; // 50 MB

export interface DesignSpecFile {
  url: string;
  expiresIn: number;
  version: number;
  stage: DesignSpecStage;
  revision: number;
  specCode: string;
  /** True when the served object is the stamped review copy rather than the original. */
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

/** An internal user's copy — the design team's original, not the stamped review copy. */
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

/** A version's bytes, held locally, plus the metadata the signing call returned. */
export interface DesignSpecObject {
  /** A `blob:` URL. The caller OWNS it and must `URL.revokeObjectURL` it. */
  objectUrl: string;
  byteSize: number;
  file: DesignSpecFile;
}

/**
 * Download a version's PDF once and hand back a local `blob:` URL.
 *
 * WHY NOT JUST PASS THE SIGNED URL TO pdf.js. The signed URL lives five minutes, and pdf.js
 * does not read a document in one go — it learns the length, then fetches page ranges lazily
 * as the reader scrolls. An internal reader keeps a spec open far longer than five minutes
 * (that is the whole point of a version viewer), so scrolling to page 30 late in a session
 * would fetch against a dead URL and blank the page with no way back but a reload. Pulling
 * the bytes down once removes the expiry from the picture entirely.
 *
 * The second reason is switching: a viewer that flips between v1 and v2 re-reads the same two
 * documents repeatedly, and a `blob:` URL makes the second visit free.
 *
 * The cost is the whole file in memory — up to `MAX_SPEC_PDF_BYTES` per version held — so a
 * caller must bound how many it keeps and revoke the rest. `DesignSpecVersionViewer` keeps
 * two.
 *
 * The reviewer path deliberately has no equivalent: a supplier opens one version once, and
 * streaming it is the lighter thing to do on a phone.
 */
export const fetchDesignSpecObject = async (versionId: string): Promise<DesignSpecObject> => {
  const file = await fetchDesignSpecFile(versionId);
  const res = await fetch(file.url, { signal: AbortSignal.timeout(5 * 60_000) });
  if (!res.ok) {
    // Reached only if the signed URL fails between being minted and being used, so the
    // actionable advice is to retry rather than anything about the file itself.
    throw new Error('Could not download that design spec. Please try again.');
  }
  const blob = await res.blob();
  return { objectUrl: URL.createObjectURL(blob), byteSize: blob.size, file };
};

interface SignedSlot { path: string; signedUrl: string }

interface UploadTargets {
  contentType: string;
  original: SignedSlot;
  /** Null for a Final Release, which is served exactly as uploaded. */
  stamped: SignedSlot | null;
}

const requestUploadTargets = async (
  specId: string,
  stage: DesignSpecStage,
  byteSize: number,
): Promise<UploadTargets> => {
  const session = await auth.getSession();
  const res = await fetch('/.netlify/functions/design-spec-upload-url', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(session?.accessToken ? { Authorization: `Bearer ${session.accessToken}` } : {}),
    },
    body: JSON.stringify({ specId, stage, byteSize }),
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
 * Upload one version's files: the original, and — unless this is a Final Release — the
 * stamped copy a reviewer is served.
 *
 * THE STAMP IS APPLIED HERE, IN THE BROWSER, before either object is uploaded — the bytes
 * are already in hand, so stamping server-side would mean moving 50MB up, down, and up
 * again. If stamping fails the whole upload fails: uploading an original with no stamped
 * copy would leave an unreleased version whose review link either serves nothing or, worse,
 * would have to fall back to the unmarked original. `design-spec-file` refuses that fallback
 * for the same reason.
 *
 * `revision` is only ever used for the words printed on the page. The database assigns the
 * real one in the insert that follows, so a losing upload in a race prints a stamp one
 * number out — cosmetic — rather than two rows claiming to be Final Release v.02.
 *
 * The original is uploaded LAST. Both objects live under paths the server chose, and the
 * version row is only written by the caller once this resolves, so a failure part-way leaves
 * orphaned objects in the bucket and no row claiming they exist — the harmless direction.
 */
export const uploadDesignSpecVersion = async (
  specId: string,
  file: File,
  stage: DesignSpecStage,
  meta: { specCode: string; revision: number; projectLabel: string },
): Promise<UploadedVersionFiles> => {
  if (file.size > MAX_SPEC_PDF_BYTES) {
    throw new Error('That PDF is larger than the 50MB limit.');
  }
  if (file.type && file.type !== 'application/pdf') {
    throw new Error('A design spec must be a PDF.');
  }

  const bytes = await file.arrayBuffer();
  const targets = await requestUploadTargets(specId, stage, file.size);

  // Read before stamping: a file pdf-lib cannot parse should fail here, at pick time, with a
  // message the designer can act on — not silently store an unstampable version.
  const pageCount = await readPageCount(bytes);

  if (stage !== 'final') {
    if (!targets.stamped) throw new Error('The server did not offer a slot for the review copy.');
    let stamped: Uint8Array;
    try {
      stamped = await stampReviewPdf({
        pdf: bytes,
        specCode: meta.specCode,
        stage,
        revision: meta.revision,
        projectLabel: meta.projectLabel,
      });
    } catch (e) {
      console.error('[uploadDesignSpecVersion] stamping failed:', e);
      throw new Error('This PDF could not be stamped for review, so it was not uploaded. Re-export it and try again.');
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
