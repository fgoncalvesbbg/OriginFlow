/**
 * Database port used when no backend is configured (`isLive === false`).
 *
 * Previously this case surfaced through `handleError`, which checked `isLive` on every
 * failure and replaced whatever went wrong with a "not configured" message. That coupled
 * error formatting to deployment state. Failing fast here instead keeps the check in one
 * place and gives the same message, without every call site paying for it.
 */
import type { DatabasePort } from './ports/database.port';
import { DataAccessError } from './ports/errors';

const NOT_CONFIGURED =
  'Connection error: the database is not configured. Please check your environment variables in Netlify.';

const fail = (context: string): never => {
  throw new DataAccessError(NOT_CONFIGURED, { kind: 'permanent', context });
};

export const createUnconfiguredDatabase = (label: string): DatabasePort => ({
  select: async (table) => fail(`${label}.select(${table})`),
  selectOne: async (table) => fail(`${label}.selectOne(${table})`),
  selectMaybeOne: async (table) => fail(`${label}.selectMaybeOne(${table})`),
  count: async (table) => fail(`${label}.count(${table})`),
  insert: async (table) => fail(`${label}.insert(${table})`),
  insertMany: async (table) => fail(`${label}.insertMany(${table})`),
  update: async (table) => fail(`${label}.update(${table})`),
  updateWhere: async (table) => fail(`${label}.updateWhere(${table})`),
  upsert: async (table) => fail(`${label}.upsert(${table})`),
  upsertReturning: async (table) => fail(`${label}.upsertReturning(${table})`),
  delete: async (table) => fail(`${label}.delete(${table})`),
  rpc: async (routine) => fail(`${label}.rpc(${routine})`),
});
