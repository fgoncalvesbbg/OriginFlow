/**
 * Vendor-neutral database port.
 *
 * Every table read/write in the app goes through this interface. It is deliberately
 * DECLARATIVE (a query is a plain object) rather than a fluent chain, because a fluent
 * chain would just be PostgREST's builder wearing a different name — and re-implementing
 * it on another backend would mean re-implementing PostgREST.
 *
 * The whole operator surface below is what the app actually uses (measured, not guessed).
 * A new backend adapter has to satisfy exactly this and nothing more.
 *
 * See ../PORTING.md for the two constructs that are NOT expressible portably
 * (`columns` embedded joins and `rpc`) and what a SQL Server adapter owes them.
 */

export type Scalar = string | number | boolean | null;

/**
 * An untyped result row, for the many reads that hand straight to a mapper in
 * `utils/mappers.utils` (all of which accept `any`). Prefer a declared row interface when a
 * service reads specific columns; use this only where a mapper immediately takes over.
 */
export type Row = Record<string, any>;

/** Explicit comparison, for the cases plain equality can't express. */
export type Condition =
  | { op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte'; value: Scalar }
  | { op: 'in'; value: readonly Scalar[] }
  | { op: 'isNull' }
  | { op: 'isNotNull' }
  /**
   * Column is an array/collection that contains ALL the given values.
   * Postgres `@>`. A SQL Server adapter must model these columns explicitly
   * (junction table or JSON) — see PORTING.md.
   */
  | { op: 'arrayContains'; value: readonly Scalar[] };

/**
 * Conjunctive (AND) filter, keyed by column.
 *
 *  - a scalar           → equality (`null` means IS NULL, not `= NULL`)
 *  - an array of scalars → IN (...)
 *  - a `Condition`      → that comparison
 *  - an array of them   → ALL of those comparisons on that column (e.g. IS NOT NULL and <= x)
 *  - `undefined`        → entry ignored, so optional filters compose without branching
 *
 * Disjunction (OR) is intentionally absent: nothing in the app needs it. Add it as an
 * explicit variant if that changes — don't smuggle it in as a raw filter string.
 */
export type Where = Record<
  string,
  Scalar | readonly Scalar[] | Condition | readonly Condition[] | undefined
>;

export interface OrderBy {
  column: string;
  /** Defaults to ascending, matching SQL. */
  ascending?: boolean;
}

export interface SelectOptions {
  /**
   * Projection. `'*'` (default) or a comma-separated column list is portable.
   *
   * PostgREST embedded-resource syntax (e.g. `'*, pm:profiles!pm_id(id, name)'`) is NOT
   * portable — it is a server-side join. Every current usage is inventoried in
   * PORTING.md; a non-PostgREST adapter must translate each to a real JOIN.
   */
  columns?: string;
  where?: Where;
  order?: OrderBy | readonly OrderBy[];
  limit?: number;
  /** Cancels the in-flight request. Required for the timeout paths to actually abort work. */
  signal?: AbortSignal;
}

export interface WriteOptions {
  signal?: AbortSignal;
  /**
   * Projection for the row read back after the write. Same semantics and portability
   * caveats as `SelectOptions.columns`. Defaults to all columns of the written table.
   * Ignored by the methods that return nothing.
   */
  columns?: string;
}

export interface UpsertOptions extends WriteOptions {
  /** Column(s) forming the conflict target, comma-separated. Defaults to the primary key. */
  onConflict?: string;
}

/**
 * All methods reject with a `DataAccessError` on failure. None of them return an in-band
 * `{ data, error }` result — that shape is a driver detail and leaks retry decisions into
 * call sites. Callers that intentionally tolerate failure wrap with the helpers in
 * `../resilience` (`orEmpty` / `orUndefined`).
 */
export interface DatabasePort {
  /** Rows matching the query; `[]` when nothing matches. */
  select<T>(table: string, options?: SelectOptions): Promise<T[]>;

  /** Exactly one row; rejects with kind `'notFound'` if there is no match. */
  selectOne<T>(table: string, options?: SelectOptions): Promise<T>;

  /** One row or `null` when there is no match. Rejects only on a real failure. */
  selectMaybeOne<T>(table: string, options?: SelectOptions): Promise<T | null>;

  /** Number of matching rows, without transferring them. */
  count(table: string, options?: Pick<SelectOptions, 'where' | 'signal'>): Promise<number>;

  /** Insert one row and return it as stored (server defaults applied). */
  insert<T>(table: string, row: object, options?: WriteOptions): Promise<T>;

  /** Insert many rows. Returns nothing: no call site needs the stored rows back. */
  insertMany(table: string, rows: readonly object[], options?: WriteOptions): Promise<void>;

  /**
   * Update matching rows and return the single affected row.
   *
   * Rejects if `where` has no effective conditions. Because `undefined` entries are dropped,
   * `{ id: maybeUndefined }` would otherwise mean "every row" — so an accidental whole-table
   * update fails loudly instead. Same for `updateWhere` and `delete`.
   */
  update<T>(table: string, values: object, options: { where: Where } & WriteOptions): Promise<T>;

  /** Update matching rows without reading anything back (may affect any number of rows). */
  updateWhere(table: string, values: object, options: { where: Where } & WriteOptions): Promise<void>;

  /** Insert-or-update. Returns nothing; use `upsertReturning` when the stored row is needed. */
  upsert(table: string, rows: object | readonly object[], options?: UpsertOptions): Promise<void>;

  /** Insert-or-update a single row and return it as stored. */
  upsertReturning<T>(table: string, row: object, options?: UpsertOptions): Promise<T>;

  /** Delete matching rows. Deleting nothing is not an error. */
  delete(table: string, options: { where: Where } & WriteOptions): Promise<void>;

  /**
   * Invoke a named server-side routine.
   *
   * NOT portable in the sense that matters: the routines themselves are Postgres
   * functions carrying the supplier-portal authorization rules (they are
   * SECURITY DEFINER, which is what lets an unauthenticated portal visitor read
   * exactly one project). A SQL Server migration must re-implement all 25 by name —
   * inventoried in PORTING.md.
   */
  rpc<T>(routine: string, params?: Record<string, unknown>, options?: WriteOptions): Promise<T>;
}
