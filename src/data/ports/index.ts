/**
 * The backend contract, in full. Nothing else in the app may import a driver SDK.
 * Implementations live in sibling folders (`../supabase` today); `../PORTING.md`
 * describes what a new one owes.
 */
export type {
  DatabasePort,
  Row,
  Scalar,
  Condition,
  Where,
  OrderBy,
  SelectOptions,
  WriteOptions,
  UpsertOptions,
} from './database.port';

export type {
  AuthPort,
  AuthUser,
  AuthSession,
  AuthChangeEvent,
  AuthSubscription,
} from './auth.port';

export type {
  StoragePort,
  UploadBody,
  UploadOptions,
  StorageObject,
  ListOptions,
} from './storage.port';

export { DataAccessError, isPermanent } from './errors';
export type { DataErrorKind } from './errors';
