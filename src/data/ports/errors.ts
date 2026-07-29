/**
 * Normalized data-access error.
 *
 * Backend drivers report failures in their own vocabulary (PostgREST returns
 * `{ code: 'PGRST116' }`, SQL Server raises numbered errors like 2627 for a unique
 * violation). Retry and user-messaging logic must NOT read those raw codes directly,
 * or it silently becomes backend-specific — `save-retry.ts` already grew a regex over
 * Postgres/PostgREST codes for exactly this reason.
 *
 * Adapters translate their driver's failure into a `DataAccessError` and classify it:
 * `permanent` means re-sending the identical request cannot succeed (constraint
 * violation, bad input, schema mismatch), so callers must fail fast instead of retrying.
 */
export type DataErrorKind =
  /** Re-sending the identical request cannot succeed. Do not retry. */
  | 'permanent'
  /** Timeout, dropped connection, expired token, transient server error. Retryable. */
  | 'transient'
  /** No row matched a query that required exactly one. */
  | 'notFound';

export class DataAccessError extends Error {
  readonly kind: DataErrorKind;
  /** Operation label for logs, e.g. 'saveIMSection'. */
  readonly context: string;
  /** Driver-native code, kept for diagnostics only — never branch on it outside an adapter. */
  readonly driverCode?: string;
  readonly cause?: unknown;

  constructor(
    message: string,
    opts: { kind: DataErrorKind; context: string; driverCode?: string; cause?: unknown },
  ) {
    super(message);
    this.name = 'DataAccessError';
    this.kind = opts.kind;
    this.context = opts.context;
    this.driverCode = opts.driverCode;
    this.cause = opts.cause;
  }
}

/** True when re-sending the identical request cannot succeed. */
export const isPermanent = (e: unknown): boolean =>
  e instanceof DataAccessError && e.kind === 'permanent';
