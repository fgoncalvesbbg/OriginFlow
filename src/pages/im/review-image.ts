/**
 * Preparing an image for a supplier review note.
 *
 * A reviewer's "image" is a screenshot or a phone photo of a printed page — a 12MP JPEG
 * carrying no more information, for this purpose, than a 1600px one. Downscaling in the
 * browser before upload is what keeps an anonymous write path from becoming a storage bill:
 * it turns a typical 6MB phone photo into ~200KB, well under the bucket's 5MB ceiling
 * (migration 132), and makes the upload finish on a bad hotel connection.
 *
 * The arithmetic and the validation are pure and live here so they can be tested under the
 * repo's `environment: 'node'` vitest setup; the canvas work that needs a real DOM is the
 * thin `downscaleImage` at the bottom.
 */

/** Longest edge, in px, an attached image is reduced to. */
export const MAX_IMAGE_EDGE_PX = 1600;

/** Most images one note may carry. Mirrors the cap in im_review_add_comment. */
export const MAX_ATTACHMENTS = 5;

/**
 * Rejected before any decoding work. The bucket enforces 5MB server-side; this is higher
 * because it applies to the ORIGINAL, which is about to be downscaled — a 15MB phone photo
 * is perfectly fine to accept and will upload as a few hundred KB.
 */
export const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** Mirrors the bucket's allowed_mime_types and the upload function's EXT_BY_TYPE. */
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** What the browser accepts in the file picker. */
export const IMAGE_ACCEPT_ATTR = ACCEPTED_IMAGE_TYPES.join(',');

/**
 * Fit a source size inside a square bound, preserving aspect ratio.
 *
 * Never scales UP: an image already smaller than the bound is re-encoded at its own size
 * rather than being blown up into a bigger, blurrier file.
 */
export const fitWithin = (
  width: number,
  height: number,
  maxEdge: number = MAX_IMAGE_EDGE_PX,
): { width: number; height: number } => {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width: Math.round(width), height: Math.round(height) };
  const scale = maxEdge / longest;
  // At least 1px on the short edge: a 4000x1 panorama must not round down to a zero-height
  // canvas, which throws.
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

/**
 * Why this file cannot be attached, or null if it can.
 *
 * A reason string rather than a tagged `{ok, reason}` union on purpose: this project does not
 * run TypeScript in strict mode, so boolean-literal discriminants do not narrow and every
 * call site would need a cast to read `reason`. A nullable string needs no narrowing, and it
 * still carries WHICH rule was hit — the reviewer is told, not just refused.
 *
 * Order matters: the per-note cap is checked first, so a full note says it is full rather
 * than blaming the file the reviewer just picked.
 */
export const validateImageFile = (
  file: { type: string; size: number },
  alreadyAttached: number,
): string | null => {
  if (alreadyAttached >= MAX_ATTACHMENTS) {
    return `A note can carry at most ${MAX_ATTACHMENTS} images.`;
  }
  if (!ACCEPTED_IMAGE_TYPES.includes(file.type as (typeof ACCEPTED_IMAGE_TYPES)[number])) {
    return 'Only JPEG, PNG and WebP images can be attached.';
  }
  if (file.size > MAX_SOURCE_BYTES) {
    return 'That image is too large (max 25 MB).';
  }
  if (file.size === 0) {
    return 'That file is empty.';
  }
  return null;
};

/**
 * Output type for a given source type.
 *
 * PNG stays PNG: a screenshot of text re-encoded as JPEG picks up ringing artefacts around
 * the glyphs, which is exactly the detail the reviewer is pointing at. Everything else
 * becomes JPEG, where the photographic content compresses far better than PNG would.
 */
export const outputTypeFor = (sourceType: string): 'image/png' | 'image/jpeg' =>
  sourceType === 'image/png' ? 'image/png' : 'image/jpeg';

/** JPEG quality for downscaled attachments. Ignored for PNG output. */
export const JPEG_QUALITY = 0.82;

/**
 * Decode, downscale and re-encode a file in the browser.
 *
 * Kept apart from everything above because it needs a real DOM (createImageBitmap + canvas)
 * and so cannot run under the node test environment. Rejects with a message meant for the
 * reviewer — a file that says it is an image but will not decode is a real case (a renamed
 * HEIC, a truncated download), and "not an image we can read" is the useful thing to say.
 */
export const downscaleImage = async (
  file: File,
): Promise<{ blob: Blob; width: number; height: number; contentType: string }> => {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('That file could not be read as an image.');
  }

  const { width, height } = fitWithin(bitmap.width, bitmap.height);
  const contentType = outputTypeFor(file.type);

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, contentType, JPEG_QUALITY),
    );
    if (!blob) throw new Error('encode failed');
    return { blob, width, height, contentType };
  } finally {
    // Frees the decoded pixels immediately rather than at the next GC. Attaching several
    // phone photos in a row otherwise holds tens of MB of bitmaps alive at once.
    bitmap.close?.();
  }
};
