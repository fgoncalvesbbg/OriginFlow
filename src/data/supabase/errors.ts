/**
 * Postgres/PostgREST failure classification. This is the ONLY place in the app that reads
 * driver-native error codes; everything downstream branches on `DataAccessError.kind`.
 *
 * The class boundaries mirror the regex that `services/core/save-retry.ts` grew over time,
 * so retry behaviour is unchanged by the move behind the port.
 */
import { DataAccessError, type DataErrorKind } from '../ports/errors';

/** No rows returned where exactly one was required. */
const NOT_FOUND_CODE = 'PGRST116';

/**
 * Re-sending the identical request cannot succeed:
 *   23xxx  integrity constraint violation (unique, FK, not-null, check)
 *   22P02  invalid text representation (e.g. malformed uuid)
 *   42xxx  syntax error or missing/undefined object
 *   PGRSTx PostgREST request/schema errors (bad column, unsatisfiable filter)
 * Auth, network and timeout failures are deliberately NOT permanent.
 */
const PERMANENT_CODE = /^(23\d{3}|22P02|42\w{3}|PGRST[12]\d\d)$/;
const PERMANENT_MESSAGE =
  /duplicate key|violates .*constraint|invalid input|malformed|is finalized|PGRST1\d\d|PGRST2\d\d|22P02|23\d{3}|42\d{3}/i;

const classify = (error: { code?: string; message?: string }): DataErrorKind => {
  if (error.code === NOT_FOUND_CODE) return 'notFound';
  if (error.code && PERMANENT_CODE.test(error.code)) return 'permanent';
  if (error.message && PERMANENT_MESSAGE.test(error.message)) return 'permanent';
  return 'transient';
};

/**
 * Turn a PostgREST/Storage/GoTrue error object into a `DataAccessError`.
 *
 * The message keeps the driver code appended when present, because the existing
 * user-facing error path (`utils/error.utils.handleError`) and the save-retry regex both
 * pattern-match on message text.
 */
export const toDataError = (error: unknown, context: string): DataAccessError => {
  if (error instanceof DataAccessError) return error;

  const e = (error ?? {}) as { code?: string; message?: string; details?: string; error_description?: string };
  const base = e.message || e.error_description || e.details || (typeof error === 'string' ? error : '') || 'Unknown database error';
  const code = e.code;
  const message = code && !base.includes(code) ? `${base} (${code})` : base;

  return new DataAccessError(message, {
    kind: error instanceof Error && error.name === 'TimeoutError' ? 'transient' : classify({ code, message: base }),
    context,
    driverCode: code,
    cause: error,
  });
};
