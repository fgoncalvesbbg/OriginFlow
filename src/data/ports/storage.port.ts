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

/**
 * How a caller proves its right to an `im-published` / `im-print` object to `signedUrl`
 * below. Exactly one of the two should be set:
 */
export interface SignedUrlAuth {
  /**
   * STAFF path: an authenticated app page. The current Supabase session's bearer token is
   * sent to the signing endpoint, which re-validates it against this project via PM-scoped
   * RLS (`authorizeProject`) — never trust the session alone, re-derive the access decision.
   */
  projectId?: string;
  /**
   * PORTAL path: an unauthenticated `/share` or `/review` page holding a live `review_shares`
   * token. The signing endpoint derives the project FROM THE TOKEN itself — a caller-supplied
   * `projectId` is never consulted on this path, so a token for project A can never mint a
   * URL under project B's prefix.
   */
  portalToken?: string;
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

  /**
   * Short-TTL signed URL for an object in `im-published` or `im-print`, minted by the
   * `im-file-url` Netlify function only after RE-VALIDATING the caller's right to the
   * project (`auth`, above) — unlike `createSignedUrl`, which only proves the vendor's own
   * storage ACL and does nothing to re-check that a share link hasn't since been revoked.
   * The other buckets that already use signed access (`documents`, `im-review-uploads`) mint
   * their own signed URLs through their own functions and do not go through this method.
   *
   * Deliberately app-specific, unlike every other member of this port: it always calls
   * OriginFlow's own signing endpoint, which only knows these two buckets' auth rules. A
   * non-Supabase adapter needs an equivalent server-side endpoint of its own, not just its
   * SDK's signing call — see ../PORTING.md. Never falls back to `publicUrl` on failure; doing
   * so would silently reinstate the hole this method exists to close.
   */
  signedUrl(bucket: 'im-published' | 'im-print', path: string, auth: SignedUrlAuth): Promise<string>;

  /** Objects directly under `folder`. */
  list(bucket: string, folder: string, options?: ListOptions): Promise<StorageObject[]>;
}
