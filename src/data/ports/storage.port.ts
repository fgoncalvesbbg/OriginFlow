/**
 * Vendor-neutral object-storage port.
 *
 * Buckets are referred to by name; the adapter owns how a name maps onto real storage
 * (a Supabase Storage bucket today, an Azure Blob container or file share later).
 *
 * The awkward member is `publicUrl`, which is SYNCHRONOUS because Supabase derives the
 * URL by string-building rather than by calling the server. Any adapter that must ask a
 * server for a URL cannot implement it — see ../PORTING.md.
 */

export type UploadBody = Blob | File | ArrayBuffer | Uint8Array | string;

export interface UploadOptions {
  contentType?: string;
  /** Cache-Control max-age in seconds, as a string (matches HTTP header semantics). */
  cacheControl?: string;
  /** Overwrite an existing object at the same path. Defaults to false. */
  upsert?: boolean;
}

export interface StorageObject {
  name: string;
  /**
   * Identifier of the stored object, or `null` for a pseudo-directory entry. Listings
   * interleave real objects with folder prefixes, and callers need to tell them apart.
   */
  id: string | null;
}

export interface ListOptions {
  limit?: number;
  sortBy?: { column: string; order: 'asc' | 'desc' };
}

export interface StoragePort {
  /** Stores the object and resolves its final path. Rejects with a `DataAccessError`. */
  upload(bucket: string, path: string, body: UploadBody, options?: UploadOptions): Promise<{ path: string }>;

  /**
   * Stable URL for an object in a public bucket. Synchronous and non-failing: it only
   * builds a string and does not verify the object exists.
   */
  publicUrl(bucket: string, path: string): string;

  /** Time-limited URL for an object in a private bucket. */
  createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;

  /** Objects directly under `folder`. */
  list(bucket: string, folder: string, options?: ListOptions): Promise<StorageObject[]>;
}
