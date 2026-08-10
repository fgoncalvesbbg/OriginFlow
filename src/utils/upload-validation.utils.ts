/**
 * Client-side upload validation.
 *
 * The AUTHORITATIVE controls are the storage buckets' own `allowed_mime_types`
 * and `file_size_limit` (enforced by Supabase Storage server-side, so they hold
 * even against a hand-crafted request). This module mirrors those limits on the
 * client for two reasons: (1) the user gets an immediate, readable rejection
 * instead of an opaque storage error, and (2) a bad file never even leaves the
 * browser. Never rely on this alone — keep the bucket limits in place too.
 *
 * SVG and HTML are deliberately excluded from every allow-list: both can carry
 * script, and these files are served from PUBLIC buckets where the browser would
 * execute them at their storage URL.
 */

/** 50 MB — kept in sync with the buckets' file_size_limit. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/** Raster images + office docs + PDF (supplier documents, RFQ quotes). */
export const DOCUMENT_MIME_TYPES: readonly string[] = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

/** Raster images only (IM inline images / pasted screenshots). */
export const IMAGE_MIME_TYPES: readonly string[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
];

/**
 * Throw a user-facing Error if `file` exceeds the size cap or its MIME type is not
 * in `allowed`. Call before any `storage.upload`.
 */
export const validateUploadFile = (
  file: File,
  allowed: readonly string[] = DOCUMENT_MIME_TYPES,
  maxBytes: number = MAX_UPLOAD_BYTES,
): void => {
  if (file.size > maxBytes) {
    throw new Error(
      `File is too large (${(file.size / 1024 / 1024).toFixed(1)} MB). ` +
        `Maximum is ${Math.round(maxBytes / 1024 / 1024)} MB.`,
    );
  }
  if (!allowed.includes(file.type)) {
    throw new Error(
      `Unsupported file type "${file.type || 'unknown'}". ` +
        `Allowed types: ${allowed.join(', ')}.`,
    );
  }
};

/**
 * A safe storage-path extension. Never derive a storage path segment straight from
 * the user's filename — restrict it to a short alphanumeric token so it cannot
 * carry path separators or other surprises.
 */
export const safeExtension = (filename: string): string => {
  const raw = (filename.split('.').pop() ?? '').toLowerCase();
  const cleaned = raw.replace(/[^a-z0-9]/g, '').slice(0, 10);
  return cleaned || 'bin';
};
