# Attribute Viewer — merging ProductToolkit's module into OriginFlow's

**Goal.** One Attribute Viewer in OriginFlow that carries ProductToolkit's (PT) full feature set,
with **OriginFlow as the system of record**. No Akeneo anywhere on a request path, no Akeneo
concepts in the data model. ProductToolkit stays reachable as an **optional pull** — the same
shape as today's category-attribute import — so every screen works standalone.

Companion analysis: [originflow-port-three-modules.md](originflow-port-three-modules.md) §3.
That document describes PT's module; this one is the implementation plan for OriginFlow.

---

## 0. Findings that shape the plan

Verified against the repo and the live database (2026-09-08), not assumed:

1. **OriginFlow makes zero Akeneo calls today.** No fetch, no client id, no token, anywhere in
   `src/` or `netlify/`. The Akeneo-shaped things that exist are all local:
   `category_attributes.akeneo_id` (a code string, the join key to PT),
   [sku-akeneo-payload.ts](../src/services/project/sku-akeneo-payload.ts) (a pure CSV/row builder),
   and `project_skus.pending_export` / `last_exported_at` (local flags).
   **"Disconnecting from Akeneo" is therefore a naming and scope job here, not a de-integration
   job.** The real work is the one PT §3.6 names: OriginFlow must *become* the value source, which
   it already is — the module just doesn't yet exploit it.

2. **There are two transposed grids over the same data.**
   [/attributes](../src/pages/products/AttributeViewer.tsx) (458 lines — read, edit one cell, flag)
   and [/products](../src/pages/products/SkuCatalog.tsx) (845 lines — editable grid, bulk upload,
   SKU roster, finalize, change log, thumbnails, column paging, XLSX export). Both write the same
   `project_skus.attribute_values` column. **Decision taken: they become one screen** (§1).

3. **The current viewer cannot see 111 of the 154 SKUs.**
   [`getSkusByCategory`](../src/services/project/sku-attribute-review.service.ts#L34) inner-joins
   `projects` and filters on `projects.category_id`, so every project-less catalog SKU
   (`project_id IS NULL`, 111 rows) is invisible, and so is any project SKU whose own
   `category_id` differs from its project's. This is exactly PT's rule 2 — *a hidden gap is a gap
   that cannot be found* — broken in the current implementation.

4. **A SKU number is not unique.** Live: many numbers appear twice (`10046631`, `10046632`,
   `10047753`, … each in two different records). PT's importer already refuses to guess which
   record an OriginFlow item number means; the merged grid has to make the same refusal visible
   (§3 Phase 4).

5. **The definition editor is already built** — inside
   [AdminDashboard.tsx](../src/pages/AdminDashboard.tsx): bulk grid editor, global attributes with
   link/unlink/promote, group ordering (`sortOrder` + `groupsInOrder`), CSV import, and the PT sync
   plan/apply with `pt_attribute_id` as the rename-safe key. PT's `DefinitionEditor` needs porting
   only for the gaps noted below — most of it already exists.

6. **There is no OriginFlow server.** The browser talks to Supabase directly. PT's write
   protection (`requirePermission`, the positional route barrier, the shared edit password) has no
   equivalent to port to. OriginFlow's equivalents are **RLS policies and Postgres triggers**, plus
   the `SUPER_ADMIN_ONLY_PATH_PREFIXES` visibility gate. Anything PT enforces "server-side" must
   become a trigger or it is not enforced at all (§2.4).

7. **EPREL was stored but never read.** `category_attributes.eprel_id` was populated from PT and
   consumed nowhere. Twelve attributes carry real EPREL field names (`energyClass`, `airFlowMax`,
   `greaseFilteringEfficiencyClass`, …), so the field-level half of a cross-check was already in
   the data — what was missing was the per-product registration number, added in migration 161.
   The fetch needs a Netlify function because the registry sends no CORS headers and its API key
   must not reach the browser. Built; see Phase 6.

8. **Only three categories have a real definition.** Glass-Ceramic Hobs (67 attributes),
   Angled Hoods (60), Chimney Hoods (59). Everything else sits on the 21 global attributes.
   Beverage Coolers has 138 SKUs against those 21. The grid's realistic worst case today is
   ~138 columns × ~67 rows — column paging matters, virtualisation does not yet.

---

## 1. Target shape

`/attributes` becomes the single Attribute Viewer. `/products` redirects to it and
`SkuCatalog.tsx` is retired once every one of its capabilities is present in the merged screen
(Phase 3 lists them as a checklist — none may be dropped silently).

```
/attributes                     the category browser (L1 › L2 › L3 tree), nothing loaded yet
/attributes?l3=<id>             the grid for one category
/attributes?l3=<id>&sku=<id>    …with the SKU panel open
```

URL-as-state, per PT: `l1`/`l2`/`l3`/`sku` are query params so back/forward work and a link is
shareable. OriginFlow uses react-router, so `useSearchParams` does this natively — none of PT's
History-API workaround is needed.

**Cell state vocabulary.** PT's eight states exist to reconcile two systems. With OriginFlow as the
record there are four, plus two that only appear when an external axis is switched on:

| State | Meaning | Colour |
|---|---|---|
| `filled` | a value is stored | plain |
| `empty` | no row — nobody has touched this cell | grey |
| `cleared` | a row with `NULL` — somebody deliberately emptied it | rose, corner flag |
| `invalid` | the stored value is not an option of its attribute / fails its type | **solid red fill** |
| `eprel-differs` | EPREL's figure genuinely disagrees (Phase 6) | violet |
| `pt-differs` | the optional PT pull found a different value (Phase 7) | amber |

`invalid` is kept for the reason PT kept it: an off-list value is real regardless of who the export
target is. `empty` vs `cleared` is kept because it is the difference between "nobody looked" and
"this product genuinely has none" — and that distinction is what a coverage number means.

---

## 2. Data model

Four migrations. `155` is the substantive one; the rest are small.

### 2.1 `155_sku_attribute_values.sql` — values become rows

Values move off `project_skus.attribute_values` (JSONB array) into one row per cell. This is what
makes coverage, per-cell provenance, per-cell audit and bulk fill cheap instead of client-side.

```sql
create table public.sku_attribute_values (
  id              uuid primary key default gen_random_uuid(),
  project_sku_id  uuid not null references public.project_skus(id) on delete cascade,
  attribute_id    uuid not null references public.category_attributes(id) on delete cascade,
  -- NULL = explicitly CLEARED. No row at all = nobody has touched this cell. Not the same thing.
  value           text,
  -- The unit belongs to the stored value, not to the attribute default (PT's Kabellaenge
  -- lesson: some products in CENTIMETER, some in METER; one default rescales half of them).
  unit            text,
  -- 'manual' | 'sheet-import' | 'pt-import' | 'supplier' | 'wizard' | 'eprel'
  source          text not null default 'manual',
  updated_by      uuid references auth.users(id),
  updated_by_name text not null default '',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (project_sku_id, attribute_id)
);
create index on public.sku_attribute_values (attribute_id);
```

Notes, each load-bearing:

- **`attribute_id` is the FK, not a code.** `category_attributes.id` is already what the JSONB
  `attributeId` carries and what `sku_attribute_flags.attribute_id` carries, so the key survives a
  rename of both the display name and the `akeneo_id`. PT keys on `akeneo_code` because it has
  nothing better; OriginFlow does.
- **Keyed on `project_sku_id`, not on the SKU number.** PT keys `attr_value` on `(sku, code)`
  because a SKU is one thing there. In OriginFlow a number can name two records (§0.4), so keying
  on the number would silently merge two products' values. The duplicate is *shown* instead
  (Phase 4).
- **`value` is text, verbatim.** A decimal column turns a German keyboard's `1,5` into an error or
  a silent `15`. Validated against `dataType` on the way in, then stored as typed — the same rule
  [`validateAttributeValue`](../src/utils/attribute-validation.utils.ts) already applies.
- **RLS** mirrors `project_skus` exactly. Copy the existing policies rather than writing new ones;
  the platform audit (2026-09) already flagged RLS-cascade drift as a P1, so a new table with
  hand-rolled policies is a regression risk. Verify with `pg_policies`, not the migration file.

**Backfill + cutover.** The migration backfills every JSONB entry into rows (non-empty values only;
a blank string in the array means "never filled", so it becomes *no row*, not `NULL`).
`project_skus.attribute_values` is **kept and dual-written** for one release, because it is read by
the PT readback API ([netlify/functions/sku-attributes.ts](../netlify/functions/sku-attributes.ts)),
the IM placeholder wizard, the supplier portal and the RFQ builder. Phase 1 makes the row table
authoritative and the JSONB a derived mirror; a later, separate change retires the mirror once
every reader is moved. **No phase in this plan deletes the JSONB column.**

### 2.2 `156_sku_change_log_attribute_cells.sql` — one history, not two

PT has a separate `attr_audit`. OriginFlow already has append-only
[`sku_change_log`](../src/services/project/sku-log.service.ts) with `project_sku_id`, `field`,
`old_value`, `new_value`, `note` and actor. Extend it rather than add a parallel table:

```sql
alter table public.sku_change_log
  add column attribute_id uuid,   -- deliberately NO foreign key; see below
  add column source text;
-- 'action' gains 'value' and 'clear' alongside finalize | unlock | update | create | delete | export
```

**Deviation from this sketch, as built:** `attribute_id` carries **no FK**. `on delete set
null` would erase which attribute an entry was about at exactly the moment that becomes the
interesting question — and attribute deletion is not hypothetical here, 172 rows were deleted on
2026-08-28. A dangling id is the correct shape for a historical record, and the trigger also
writes the attribute's **name** into the existing `field` column, so an entry stays readable after
its attribute is gone. `'clear'` is a separate action from `'value'` for the same reason the value
model separates them: emptying a field is an act, not an update to `''`.

Every write to `sku_attribute_values` logs here — **by trigger, not by client code**, so a new
write path cannot forget it. That is the structural version of PT's "append-only audit in every
module".

### 2.3 `157_sku_review_status.sql` — finalize, with a reason to reopen

`project_skus.is_final` already exists. Add what PT's `attr_sku_status` carries beyond it:

```sql
alter table public.project_skus
  add column finalized_at   timestamptz,
  add column finalized_by   uuid references auth.users(id),
  add column reopen_reason  text;
```

The reopen reason shows on the SKU column header — PT's point being that a reader scanning a
hundred columns should be able to see *why* one is still open.

### 2.4 `158_final_sku_write_barrier.sql` — the refusal, as a trigger

PT's server refuses a value write on a Final SKU unless the change is explicitly acknowledged.
With no OriginFlow server, a client-side check is a suggestion. So:

```sql
-- BEFORE INSERT OR UPDATE ON sku_attribute_values:
--   if the owning project_sku.is_final then raise, unless the SKU was unlocked first.
```

Unlocking is the existing `setSkuFinal(id, false)` path, which already logs. The dialog then
becomes what it should be — an explanation of a refusal that already happened — rather than the
only thing standing between Final and an edit.

**What is deliberately *not* ported:** PT's `ATTRIBUTE_VIEWER_EDIT_PASSWORD`. A shared password
checked in a browser against a Supabase table is theatre. The equivalent barrier in OriginFlow is
role + RLS, and the module stays behind `SUPER_ADMIN_ONLY_PATH_PREFIXES` until it is ready — which
is a visibility gate, not security, and the config file
([moduleAccess.config.ts](../src/config/moduleAccess.config.ts)) already says so.

---

## 3. Phases

Effort is engineering days for one person. Phases 1–4 are the merge; 5–8 are the features that make
it PT's module rather than OriginFlow's current one.

### Phase 0 — Groundwork (0.5 d)

- Commit the pending working-tree changes (`154_super_admin_flag.sql`, `SuperAdminRoute.tsx`,
  `moduleAccess.config.ts`) so the graph and the plan start from a clean base.
- `node scripts/graph-query.mjs index --write` — the index is older than the graph.
- **Fix the SKU source first, before anything else is built on it.** Replace `getSkusByCategory`'s
  single join with a union of (a) `project_skus.category_id = <l3>` and (b) SKUs whose project
  carries the category. This alone takes the viewer from 43 visible SKUs to 154 and is
  independently shippable.

### Phase 1 — Value rows and the service layer (2.5–3 d)

- Migrations 155–158. Apply to live; **verify with `pg_policies` and a row count**, not by reading
  the migration file (repo migrations have drifted from prod before).
- New `src/services/project/sku-attribute-value.service.ts`:
  `getValuesForSkus(skuIds)` · `setValue(skuId, attrId, value, unit, source, actor)` ·
  `clearValue(...)` (writes `NULL`, does not delete the row) · `bulkSetValue(skuIds, attrId, …)` ·
  `copyFromSku(sourceSkuId, targetSkuIds, groups)` · `getCoverage(categoryId)`.
- `updateProjectSku` keeps working: it now writes rows *and* refreshes the JSONB mirror in the same
  call, so every existing caller (supplier portal, wizard, RFQ, PT readback) is unaffected.
- Unit tests for: `empty` vs `cleared`; unit-travels-with-value; type validation rejecting before
  write; the Final trigger refusing; the audit row appearing without the caller asking.

#### Phase 1 — as built (2026-09-08)

Written and green: `npx tsc --noEmit` clean, 1,715 tests pass (37 new).

| Artefact | What it is |
|---|---|
| [155_sku_attribute_values.sql](../db_migrations/155_sku_attribute_values.sql) | the table, four RLS policies mirroring `project_skus`, the backfill |
| [156_sku_change_log_attribute_cells.sql](../db_migrations/156_sku_change_log_attribute_cells.sql) | `attribute_id` + `source` on the log, `value`/`clear` actions |
| [157_sku_review_status.sql](../db_migrations/157_sku_review_status.sql) | `finalized_at` / `finalized_by` / `reopen_reason`, backfilled from the log |
| [158_sku_attribute_value_guards.sql](../db_migrations/158_sku_attribute_value_guards.sql) | the Final lock, the audit trigger, session-derived actor, finalization stamping |
| [sku-attribute-value.utils.ts](../src/utils/sku-attribute-value.utils.ts) | all the judgement, pure and fixture-tested |
| [sku-attribute-value.utils.test.ts](../src/utils/sku-attribute-value.utils.test.ts) | 37 tests |
| [sku-attribute-value.service.ts](../src/services/project/sku-attribute-value.service.ts) | the I/O: reads, writes, bulk, copy, the JSONB bridge |

**Two findings that changed the work:**

1. **The backfill writes zero rows, and that is correct.** Measured before writing it: all 141
   JSONB entries across all 154 SKUs hold `"value": ""`, and 102 point at attributes deleted on
   2026-08-28. They are placeholder scaffolding from the SKU Catalog's add-SKU path, never filled.
   So there is no attribute-value data in OriginFlow to migrate or to lose, and migration 155 is a
   clean-slate table rather than a data migration. The backfill is still written to be correct if
   it is ever re-run against a database that does hold values.

2. **`validateAttributeValue` in `'text'` mode calls a stored range invalid.** A numeric attribute
   with `allowRange` legitimately holds `100-200`; `'text'` mode runs it through `Number()`, gets
   `NaN`, and the cell would have rendered as a solid red invalid. `validationModeFor` picks the
   mode using the same rule `SkuAttributeCellDrawer` uses to decide whether to open in range mode,
   so the grid and the editor can never disagree about whether a value is valid. Four tests pin it.

**Deliberate design choices beyond the sketch:**

- **The service decides nothing.** Every judgement — cell state, coverage, what a bulk fill will
  write and why it skipped the rest, what a blank JSONB entry means — is a pure function in
  `sku-attribute-value.utils.ts`. The service does I/O and calls them. That is PT's "pure `lib/`"
  rule, and it is why "why was this SKU skipped?" is answerable by reading one function.
- **`syncValueRowsFromJsonb` resolves the attribute definitions itself** rather than taking them as
  an argument, and `updateProjectSku` calls it whenever `attributeValues` is written. So all three
  existing call sites (Attribute Viewer, SKU Catalog, Project Detail) keep the row store in sync
  without changing, and a fourth cannot forget to.
- **A failed row sync never fails the SKU save.** The array write has already succeeded and is what
  every current reader uses. It is logged, not thrown — which also means the app keeps working
  unchanged until 155 is applied.
- **Coverage is computed client-side** from the values the grid has already loaded, not by a
  server-side aggregate. A category's worst case is ~138 SKUs; an RPC would be a round trip and a
  deployment for an arithmetic loop.
- **`setSkuAttributeValue` rejects a value its attribute cannot hold.** Cells still render
  `invalid` — that happens when a definition changes *underneath* stored values (an option dropped
  from an enum, a tightened min/max), which is a real problem worth showing rather than one to hide
  by never checking.
- **`isValueStoreAvailable()`** exists because `orEmpty` turns a PostgREST 404 on an unapplied
  migration into an empty grid, which reads as "this category has no values" — a wrong answer
  presented confidently. One cheap probe lets the UI say "the value store is not deployed" instead.

**Applied and verified against live, 2026-09-08.** Structure: table present, 4 RLS policies with
the right USING/CHECK shape, 2 triggers on `sku_attribute_values`, 1 on `project_skus`, `0` value
rows exactly as predicted. Behaviour — all eight checks passed:

| Check | Result |
|---|---|
| INSERT logs one `value` row carrying the attribute **name** in `field` | ✓ |
| UPDATE logs `old_value` → `new_value` | ✓ |
| A no-op UPDATE produces **no** entry | ✓ |
| Setting `value = null` logs `clear`, not `value` | ✓ |
| `is_final = true` stamps `finalized_at` | ✓ |
| A value write on a Final SKU **raises** | ✓ |
| Unlocking clears the stamp and lets the write through | ✓ |
| Deleting a Final SKU is not blocked by the barrier (cascade path) | ✓ |

Run inside a `DO` block that raised at the end, so the whole thing rolled back; confirmed
afterwards that nothing persisted (0 value rows, 0 cell logs, 154 SKUs, 0 stamped). The one thing
that route cannot exercise is the session-derived actor — `auth.uid()` is null with no JWT, so only
the caller-supplied fallback ran. That needs one real edit through the UI.

#### Phase 0's SKU-source fix — done (2026-09-08)

[`getSkusByCategory`](../src/services/project/sku-attribute-review.service.ts) now unions the two
routes a SKU can belong to a category, with `mergeCategorySkus` extracted and
[tested](../src/services/project/sku-attribute-review.service.test.ts) (6 tests). Measured on live:
**Beverage Coolers went from 27 SKUs to 138** — the 111 catalog SKUs the project-only inner join
was dropping. Deduplication is by SKU **record id**, never by number, so two records sharing a
number both survive as columns.

#### Phase 2's first slice — done (2026-09-08)

The existing grid now reads and writes the row store, so Phase 1 is exercised rather than dormant:

- Values load via `getValuesForSkus` and are indexed once (`indexByCell`); cells render through
  the four-state vocabulary in
  [cell-state.ts](../src/components/products/attribute-grid/cell-state.ts) — hue **and** a label,
  with a legend that carries a live count per state.
- **A cleared cell renders as the word "none"**, not a dash. A dash would be indistinguishable
  from untouched, which is the distinction the store was restructured to keep.
- Per-attribute **coverage** (`87/138`) on every row header; required attributes marked.
- An open flag is now an inset amber **ring** rather than an amber background, so it reads on top
  of the cell's own state colour instead of competing with it.
- The drawer shows the cell's state, its **provenance** ("from a supplier submission by X on …",
  plus the unit), and has an explicit **Clear** button. Saving a blank is refused with a message
  saying why: a blank cannot say whether you mean "not filled in yet" or "this product has none".
- `isValueStoreAvailable()` drives a banner, so an unapplied migration says so instead of
  rendering every cell as an untouched gap.
- Orphaned JSONB values (an attribute no longer defined, so no row can exist) are **counted and
  reported** under the grid rather than dropped silently. Live that is 0, since all 102 are blank.

`tsc --noEmit` clean, `vite build` clean, **1,721 tests pass**.

#### Phase 2 — the grid engine, done (2026-09-08)

| File | What it is |
|---|---|
| [grid.utils.ts](../src/components/products/attribute-grid/grid.utils.ts) | all the maths, pure |
| [grid.utils.test.ts](../src/components/products/attribute-grid/grid.utils.test.ts) | 31 tests |
| [AttributeGrid.tsx](../src/components/products/attribute-grid/AttributeGrid.tsx) | the grid: sticky axes, bands, sort, keyboard, inline edit |
| [SkuHeader.tsx](../src/components/products/attribute-grid/SkuHeader.tsx) | the column header |
| [Thumb.tsx](../src/components/products/attribute-grid/Thumb.tsx) | thumbnail with its fallback chain |

- **Both axes sticky.** A value is meaningless without both coordinates and at this size you are
  always scrolled away from one.
- **Collapsible cluster bands**, ordered by first appearance via `groupsInOrder` — *not* by
  iterating `ATTRIBUTE_GROUPS`, which would silently DROP every row in an unregistered
  ProductToolkit cluster. Three tests pin that, including "loses no rows, whatever the groups are".
- **Click an attribute row to order the SKU columns by it**, asc → desc → off. Type-aware, and
  **blanks last in BOTH directions** — flipping to descending to see the largest must not fill the
  first screen with gaps.
- **Column paging at 25**, clamped rather than blanked when a filter shrinks the set. **Comparison
  ignores paging**: somebody who ticked five products wants those five, not "the first 25 of 5".
- **The full keyboard model.** `Enter` down (next attribute, same product) · `Tab`/`Shift+Tab`
  across (next product, same attribute) · `F2`/double-click to edit · `Esc` abandons · arrows
  navigate · `Shift+Enter` opens the SKU. Movement **clamps** at the edges rather than wrapping —
  wrapping in a 70-column grid throws the selection most of a screen sideways for an invisible
  reason. `visibleRows` walks only what is on screen, so `Enter` cannot land inside a collapsed
  band and lose the selection.
- **The editor is not offered on a signed-off SKU.** The database refuses it anyway; not offering
  it is the honest version, so nobody types into forty fields before finding out.
- **The unit renders above the value** in small grey type, so what you edit is the value alone.
- **The column header** in PT's order — tick → thumbnail → number → title → status → counts — plus
  a **colour band down the side** taking the colour of whatever most needs attention in that
  column. A duplicated item number is badged `2 records` with the other record named in the
  tooltip; nothing merges them.
- **Coverage is computed over the whole filtered category, not the visible page** — "87 of 138
  answer this question", not "23 of the 25 the pager happens to be on". The grid takes it as a prop
  rather than computing it, so it cannot accidentally become page-local.
- `Thumb` keeps PT's three hard-won behaviours: same box size on failure, **keyed on the
  candidate** so a fallback replaces the element (swapping `src` on a failed `<img>` does not
  reliably re-fire `onError`), and multiple candidates.

`tsc --noEmit` clean, `vite build` clean, **1,817 tests pass**. `knip` run to remove the
speculative exports this work left behind.

**Not verified: the interaction itself.** vitest runs in a `node` environment and every test in
this repo is pure logic — there is no component-render stack, and adding one (jsdom +
testing-library) is a dependency decision rather than something to slip in here. So sticky
behaviour, band collapsing, sort clicks and the keyboard model are covered by their pure functions
and by the typechecker, but nobody has yet *looked* at the grid. It needs a pass in the browser
with a real category open.

### Phase 2 — The grid engine (3.5–4 d)

A new `src/components/products/attribute-grid/` with the presentational grid and pure helpers, so
the maths is testable without React — PT's "pure `lib/`" rule, which is the reason their grid stayed
maintainable:

- `grid.utils.ts` (pure): row/column assembly, coverage per row, type-aware sort with **blanks last
  in both directions**, cell-state classification, filter predicates. Fixture-tested.
- Transposed grid: attribute rows × SKU columns, **collapsible cluster bands** from `attr.group` in
  `groupsInOrder` order, **sticky first column and sticky header row**, per-row coverage
  (`87/138`), **click a row to sort columns by it** (asc → desc → off).
- SKU column header, in PT's order: tick box → thumbnail → number → title → status chip → per-SKU
  counts, plus a **colour band down the side** in the same palette as its cells.
  Reuse `skuThumbnailUrl` from SkuCatalog, but port PT's `Thumb` behaviour: **multiple candidates,
  same box size on failure, keyed on the item number so a fallback replaces the element** (swapping
  `src` on a failed `<img>` does not reliably re-fire `onError`), `loading="lazy"`.
- **Column paging at 25**, as PT — SkuCatalog's 20 is close enough that either is fine; take 25 for
  "about two screens wide". Comparison mode ignores paging.
- One frozen `const NONE = Object.freeze([])` shared by every empty fallback, so the memos over
  thousands of cells don't recompute on identity churn.
- **Spreadsheet keyboard model, in full:** click selects · double-click / `Enter` / `F2` edits ·
  `Enter` saves and moves **down** · `Tab` / `Shift+Tab` moves **across SKUs**, same attribute ·
  `Esc` abandons · arrows navigate · `Shift+Enter` opens the SKU panel.
- **Units shown, not typed:** the number in the cell, the unit above it in small grey type.

### Phase 3 — Absorb SKU Catalog (2–2.5 d)

Every SkuCatalog capability must be present before `/products` is retired. This is the checklist,
and it is a gate — **completed 2026-09-08**:

- [x] add a SKU to a category (project-less catalog SKU) — `AddSkuDialog`
- [x] delete a SKU, with its change-log entry — `SkuDialog`, logged **before** the delete
- [x] bulk upload a transposed values sheet (`parseSkuCsv`) — `SkuSheetUploadDialog`
- [x] SKU roster upload (`parseSkuRoster`) — `SkuRosterDialog`
- [x] finalize / unlock with the change log (`setSkuFinal`) — `SkuDialog`, and the unlock reason
      now lands in `reopen_reason` as well as the log, so the column header can show it
- [x] the per-SKU change-log viewer (`getSkuChangeLog`) — `SkuDialog`
- [x] the outbound row export (`buildAkeneoRows`) and `markSkusExported`
- [x] "only changed" filter (the `pending_export` flag)
- [x] thumbnails — `Thumb` (Phase 2)
- [x] **edit a SKU's number and title** — not in the original checklist, and it would have been
      lost: SkuCatalog carried it in grid cells. It is a SKU-level fact, so it is in `SkuDialog`.
- [x] `/products` → `<Navigate to="/attributes" replace />`, sidebar entry dropped,
      `SkuCatalog.tsx` (845 lines) deleted.

**Deliberately NOT ported: the draft-then-save editing model.** SkuCatalog tracked dirty cells and
committed them with one Save, diffing old against new to write the log. Phase 1 replaced that with
per-cell immediate writes whose audit is written by a trigger. Two editing models cannot share one
grid, and the trigger-written audit is strictly better than a client-side diff — it cannot be
forgotten by a new write path. So `saveAll` / `diffSku` / the dirty-set are gone, not missing.

**Access changed, and not silently.** Before the merge `/attributes` was a read-and-flag screen
open to every authenticated user, while `/products` — which could add, delete, bulk-overwrite,
finalize and export — was Super-Admin gated. Merging them put those destructive capabilities on the
open URL. Rather than widen who can delete a SKU as a side effect of a refactor, **`/attributes` is
now in `SUPER_ADMIN_ONLY_PATH_PREFIXES`** and its route is wrapped in `SuperAdminRoute`. Removing
it from that list is the deliberate act of opening the module up — it is a decision, not a leftover.

**Two real bugs found and fixed while doing this:**

1. `createCatalogSku` and `bulkUpsertCatalogSkus` write `attribute_values` **directly**, not
   through `updateProjectSku` — so the authoritative row store would have drifted behind the
   mirror on every add and every sheet upload. Both now call `syncValueRowsFromJsonb`, and the
   bulk path tags its writes `'sheet-import'` rather than `'manual'`.
2. `setSkuFinal` wrote the unlock reason only to the change log, leaving migration 157's
   `reopen_reason` column permanently null — so the column-header badge built in Phase 2 could
   never have appeared.

`getCatalogSkus` was removed with the page: SkuCatalog was its only caller, and "read every SKU in
the system, filter client-side" is the shape the merge moved away from.

`tsc --noEmit` clean, `vite build` clean, **1,835 tests pass**.

**Naming.** `buildAkeneoRows` and `pending_export` keep their column and function names (renaming
touches many files for no behavioural gain) but the **UI stops saying Akeneo**: "Export rows" and
"Changed since last export". `akeneo_id` stays as a column and is labelled **"External code"** in
the editor, with the PT/Akeneo code shown as its help text — it is the join key for the optional PT
pull and for any downstream consumer, and it is not a connection to anything.

### Phase 4 — Category browser, filters, tiles, panels (2–2.5 d)

- **Category browser as the entry point**, not a dropdown: the L1 › L2 › L3 tree from the existing
  [`getCategoryTree`](../src/services/compliance/compliance-category.service.ts#L17), each L3
  showing its SKU count and attribute count. Categories **with no definition are listed and
  marked**, not hidden — PT's rule, and with only 3 of ~200 categories defined it is the single most
  useful thing this screen can say.
- **Summary tiles that are toggles**: SKUs · coverage % · required gaps · invalid cells ·
  duplicate-number records · not-in-any-project. Clicking the active tile turns its filter back off.
- **Filter panel that collapses to a rail showing the active filter count**, so a collapsed panel
  can never hide that it is filtering.
- Row filters: `all` · `edited` · `required-gap` · `incomplete` · `complete` · `invalid` ·
  `flagged` · `cleared`. Per-attribute value filters keep the current chip UI but gain the
  **spelled-out `__no_value__` sentinel** — a blank string in a `<select>` is indistinguishable from
  "no option chosen".
- **SKU side panel** (`?sku=`): all of that SKU's attributes by cluster, its change log, its flags,
  its status. This is the surface for filling one SKU in from empty, and it absorbs today's
  [SkuAttributeCellDrawer](../src/components/products/SkuAttributeCellDrawer.tsx) rather than
  replacing it — the drawer's per-cell flag UI stays available from a row.

  **Corrected 2026-09-09.** Phase 4 was marked done with `SkuDialog` carrying identity, status,
  history and delete but **no attribute list** — the half the plan actually singled out. Built as
  [SkuValuePanel.tsx](../src/components/products/SkuValuePanel.tsx) and placed above Review status,
  because filling the product in is why most people open the panel and signing it off is what they
  do once. Collapsible cluster bands with a filled/total per band and for the SKU, the unit and
  `wizardHint` beside each question, the four cell states named, an inline Clear, the flag opening
  the per-cell drawer, and the EPREL figure with its "use …" affordance where the registry has an
  opinion. Editing writes immediately, one cell at a time — deliberately **no "save all"**, since a
  draft-then-commit form over 70 fields is the model Phase 3 replaced, and reintroducing it here
  would give one SKU two different editing contracts.

  *Why it earns its place beside the grid:* the grid compares one question across many products
  (read along a row). Filling in one product is the transposed job — ~70 answers about the same
  thing — which in the grid means tabbing down a single column with the attribute names scrolled
  off to the left.
- **Duplicate-number honesty:** when a number names two records, both columns render, each badged
  `2 records` with its project name (or "catalog"), and the badge links to the other. Nothing merges
  them and nothing picks one.

#### Phase 4 — done (2026-09-08)

| File | What it is |
|---|---|
| [grid-filters.utils.ts](../src/components/products/attribute-grid/grid-filters.utils.ts) | row filters, column filters, the value sentinel, the summary maths — pure |
| [grid-filters.utils.test.ts](../src/components/products/attribute-grid/grid-filters.utils.test.ts) | 26 tests |
| [CategoryBrowser.tsx](../src/components/products/attribute-grid/CategoryBrowser.tsx) | the L1 › L2 › L3 entry point |
| [SummaryTiles.tsx](../src/components/products/attribute-grid/SummaryTiles.tsx) | six tiles, each a toggle |
| [FilterRail.tsx](../src/components/products/attribute-grid/FilterRail.tsx) | the panel that collapses to a rail |
| [render-smoke.test.tsx](../src/components/products/attribute-grid/render-smoke.test.tsx) | grew to 35 tests |

- **URL as state.** `?l3=` (what is open) and `?sku=` (which panel) are query params via
  `useSearchParams`, so each view is a real address — back and forward walk through them and a
  link goes straight to a category. Opening a different category drops the `sku` param rather
  than leaving a stale panel open, and a panel change uses `replace` because a drawer is not a
  place in history.
- **The category browser is the entry point, not a dropdown.** Nothing loads until a category is
  picked, because opening one reads every attribute of every SKU in it. It shows the hierarchy
  (via the existing `groupByL1L2`) because the catalogue is ~200 categories and nobody holds
  that as a flat list. **A category with no attributes is listed and marked**, and the header
  counts how many — with only 3 of ~200 defined, that is the most useful thing the screen says.
  A leaf with no parent lands in the Uncategorised bucket rather than vanishing.
- **`getCategorySkuIndex`** feeds it with one read of the whole table's id columns rather than a
  count per category — 200 round trips replaced by one, on a landing page where the operator has
  not yet asked for anything expensive. It applies the same own-category-then-project precedence
  as `getSkusByCategory`, so the browser's number and the grid's number cannot disagree.
- **Two filter axes, kept apart.** A row filter hides attributes ("required, with a gap"); a
  column filter hides SKUs ("not in any project"). Collapsing them into one list reads simpler
  and is wrong — "invalid" means different things on each axis and both get asked.
- **Tiles are toggles.** Clicking the tile for a filter already on turns it off, so nobody is
  stuck in a filtered grid they cannot leave by clicking what got them there. An active tile
  says *"filtering · click to clear"* in words, not just colour. The numbers describe the whole
  category, because a tile is how you *get* to a filtered view.
- **The rail carries the active filter count** — the reason the panel may collapse at all. A
  hidden panel plus a filtered grid is how somebody concludes a category has 4 SKUs when it has
  138. Collapsed it reads *"filtering"* with a count; with nothing on, just *"filters"*.
- **The `__no_value__` sentinel is spelled out.** In a `<select>` a blank option value is
  indistinguishable from "no option chosen", so a filter for *absence* and a filter that is
  *off* would be the same thing. It matches both an untouched and a cleared cell — both are "no
  answer here", and the cell's own colour still tells them apart.
- `'complete'` is deliberately **false** for a category with no SKUs: "every one of zero products
  has a value" is true, useless, and would paint an empty category entirely green.

`tsc --noEmit` clean, `vite build` clean, **1,896 tests pass**.

#### On verification, since it was raised three times

There is now a [render smoke suite](../src/components/products/attribute-grid/render-smoke.test.tsx)
— 35 tests using `react-dom/server`, which needs no new dependency (react-dom is already here)
and no jsdom. It proves the render trees do not throw and that the right content reaches the
page: the cleared cell reading `none`, coverage, the duplicate badge, the invalid count, the
provenance line, the "no attributes yet" marking, the rail's filter count.

**What it still cannot cover:** `useEffect` never runs under `renderToString` and there are no
events. So data loading, click handlers, the keyboard model and the sticky/scroll behaviour are
not exercised. The keyboard and sort maths are covered as pure functions; the *feel* of the grid
has still never been seen. That gap is now much narrower than "1,500 lines unverified", but it
is not closed.

### Phase 5 — Bulk fill, copy-from, flags at scale (1.5–2 d)

- Tick SKU headers → **Bulk fill** one attribute across them, or **Copy from** a reference SKU by
  cluster. Both **default to empty cells only**, and both **report per SKU** what was set, skipped
  as already filled, or skipped as signed-off. Server-side (RPC) so 138 SKUs is one round trip.
- Comparison view for the ticked SKUs (ignores column paging).
- The existing flag model needs no change; it already keys on `(project_sku_id, attribute_id)`.

#### Phase 5 — done (2026-09-08)

[BulkValueDialogs.tsx](../src/components/products/BulkValueDialogs.tsx) — `BulkFillDialog` and
`CopyFromDialog`, both preview-then-apply over the planners built in Phase 1
(`planBulkFill` / `planCopyFrom`, already fixture-tested).

- **The plan is recomputed as you type**, so the consequence is visible before the button is
  pressed rather than reported after it. The service writes exactly what the plan said, so what
  was shown and what happened are the same list.
- **Reported per SKU, grouped by outcome**, each with words: *will be set* · *already has a
  value* · *signed off — unlock it first* · *value is not valid for this attribute*. "It set 12
  of 40" is not an answer anybody can act on.
- **Empty cells only, by default.** Overwriting is available but must be asked for, and the
  toggle says out loud that it also overwrites cells somebody deliberately emptied.
- **Copy-from works by cluster**, not attribute-by-attribute: "give these the same dimensions as
  that one" is the actual request. Only attributes the reference *holds* are copied — a cleared
  or absent source cell proposes nothing, and the dialog says so, because copying "none" across
  forty products is a mass clear wearing the clothes of a copy.
- The reference SKU may be one that is **not ticked** (`allSkus` is passed alongside `skus`).
- Both reload the category afterwards rather than patching cells locally: a bulk write touches up
  to 138 cells plus their audit rows and mirror, all server-side, so re-reading is the only way
  to be sure the grid matches what landed.

### Phase 6 — EPREL cross-check — **UNBLOCKED and built (2026-09-09)**

The blocker was that OriginFlow stored no per-product EPREL registration number. It needed no
schema change — attribute values are exactly how OriginFlow holds per-SKU facts — only a missing
attribute. Added, and the cross-check built on it.

| File | What it is |
|---|---|
| [161_eprel_id_global_attribute.sql](../db_migrations/161_eprel_id_global_attribute.sql) | the "EPREL ID" global attribute (applied) |
| [eprel-compare.utils.ts](../src/components/products/attribute-grid/eprel-compare.utils.ts) | all the comparison tolerance — pure |
| [eprel-compare.utils.test.ts](../src/components/products/attribute-grid/eprel-compare.utils.test.ts) | 60 tests |
| [eprel-lookup.ts](../netlify/functions/eprel-lookup.ts) | the server-side registry call |
| [eprel.service.ts](../src/services/project/eprel.service.ts) | the client, failing soft |

**Scoped to 34 energy-labelled categories, not global** (migration 165). It was created global,
which — because it is supplier-visible — started asking every supplier for an EPREL registration
number on pergolas, kitchen knives and dartboards. Nothing in OriginFlow records which categories
are energy-labelled, so the set is a reading of the EU labelling regulations written out in full in
the migration so it can be argued with, including the exclusions and their reasons. It is a seed:
the Admin panel's attribute→category assignment adjusts it without another migration.

*Originally, and kept here because the reasoning still applies to genuinely global attributes:*
**one row, not ~200.** `category_id IS NULL` means
`getAttributesForCategory` returns it for every category, so "add it to all categories" is one
row; a later correction is one edit and cannot drift between categories. Text, not numeric (a
numeric column drops a leading zero). Supplier-visible, because for a supplier-manufactured model
the supplier registered it and holds the number. Placed at `sort_order` 41, immediately above
"Energy efficiency class", so the energy block reads key-then-figures.

**Do not confuse the two EPREL things**, because they are one word apart and both now matter:
`category_attributes.eprel_id` (the column, migration 138) names a **field inside** an EPREL
record — *what to compare*. The "EPREL ID" attribute (migration 161, a row) holds the
registration number — *which product to fetch*. The column alone was never enough.

**The field-level mapping was already in the data.** Twelve attributes already carry real EPREL
field names written by the team — `energyClass`, `energyAnnual`, `airFlowMax`,
`greaseFilteringEfficiencyClass`, `soundPowerBoost`, `powerConsumptionStandbyMode` — so the
comparison reads the registry's record by those keys and never needs to know its schema.

**The comparison tolerances, which are the point.** Comparing naively produces a grid of false
alarms; upstream, class folding alone turned 81 false mismatches on one category into zero.
Ported in full and fixture-tested:

- **Units stripped** — `641.0000 CUBIC_METER_PER_HOUR` and `641 m³/h` both compare as `641`.
- **Precision tolerated at the coarser of the two** — `0.44` agrees with `0.4`, not with `0.5`.
  Trailing zeros are not precision: `641.0000` is a whole number written verbosely.
- **Class codifications folded both ways** — `A++`, `a_plus_plus` and EPREL's shorthand `APP`
  all reduce to `A++`. Applied **only** where the attribute's own options are a class scale, so
  `AP` folds to `A+` on an energy scale but stays `AP` on some other select where it might be a
  legitimate option.
- **"EPREL has it, we don't" is a separate verdict** from "they disagree". One is a gap to fill,
  the other a value to fix, and reporting them together sends people to the wrong job.
- **No safe equivalent ⇒ offer nothing.** A canonical class the scale does not offer (the live
  lighting scale runs A–E then G, so a canonical F has no home), a fractional figure for an
  integer field, a non-exact match on a non-class select — each produces no suggestion, and the
  drawer says the figure has no safe equivalent rather than pre-filling a guess.

**Fetched after the grid paints**, in its own effect, never inside `loadCategory`. The registry is
a public service we do not own; folding it into the main load would let a slow or rate-limited
EPREL delay or fail the whole page. A category where nobody captured a registration number does
no work at all.

**Presented as an overlay, not a fifth cell state.** What the registry says is a different
question from what our record holds — a cell can be `filled` *and* disagree with EPREL, and both
matter at once. So violet is a ring plus the registry's figure in small type under ours, and an
open flag outranks it (somebody explicitly asked for that cell to be looked at). The legend strip
states how the axis was read and when: *not checked* · *checking* · *unavailable* ·
`3 differ · 2 fillable · 41 agree · 6/8 found at 14:20`.

**Edit starts from EPREL**, offered and never applied on open — seeding automatically would
silently replace what somebody typed. The banner says the value came from the registry and one
click restores the old one.

#### What is verified about the API, and what is not

Verified from the Commission's own pages (2026-09-09): the public API is at
`https://eprel.ec.europa.eu/api`, answers JSON, is keyed on the registration number, **requires
an API key** ([request form](https://eprel.ec.europa.eu/screen/requestpublicapikey)), and
**returns only VERIFIED models** — an unverified registration answers as absent, which the
function reports as `not-found` rather than as an error.

**Not** verified, because the endpoint syntax lives in the EPREL wiki behind EU Login: the exact
product path and the API-key header name. Both are therefore **env templates**
(`EPREL_PRODUCT_PATH`, `EPREL_API_KEY_HEADER`) rather than hard-coded guesses, so a correction is
a deploy variable and not a release. `POST { "probe": true }` to the function echoes the exact URL
and header it would use — never the key — so they can be checked against the wiki without reading
the source.

**PARKED, by decision (2026-09-09).** Built and dormant: with `EPREL_API_KEY` unset the axis reads
*unavailable* and costs nothing. Switching it on needs three things from outside this repo — an API
key from the Commission, the two unverified endpoint parameters checked against the EPREL wiki (EU
Login), and EPREL IDs captured against SKUs. None is urgent; the comparison layer and the fetch are
tested and waiting.

### Phase 7 — The ProductToolkit value pull — **BLOCKED, not built** ⛔

Also researched first. **ProductToolkit exposes no unauthenticated endpoint carrying per-SKU
values.**

- The only two public endpoints are `/definitions` and `/definitions/{l3}` — verified live
  2026-09-03 and documented in
  [producttoolkit-attributes.service.ts](../src/services/compliance/producttoolkit-attributes.service.ts).
  Both return attribute **definitions**, not values.
- Every value-bearing route (`/category?l3=`, `/compare?skus=`, `/export/akeneo`,
  `/changes/:sku`, `/pending`) sits **above PT's write barrier but still behind its SSO session**.
  "Above the write barrier" only means no editor role is required; it does not mean open. §3.5 of
  the companion doc is explicit that `/definitions` is *"the only hole in the session barrier"*.
- OriginFlow has no server inside PT's network, and a browser fetch cannot carry PT's session.

**What unblocks it:** ProductToolkit adding a value-bearing read to its `openReads.js` allowlist —
the same carve-out `/definitions` already has. That is a change in ProductToolkit, not here.

**What already works and needs nothing:** the definition pull (`getProductToolkitDefinitions` /
`planAttributeSync` / `applyAttributeSync`), and the *outbound* readback where PT reads values
**from** OriginFlow via the authenticated `netlify/functions/sku-attributes.ts`. So the two
systems do exchange data — just not values in this direction.

### Phase 7 (specification, for when ProductToolkit opens a values read)

Same shape as the category-attribute import that already works, and it is the answer to "there
should always be a possibility to connect to ProductToolkit". Two directions, already asymmetric:

- **Definitions (exists).** `getProductToolkitDefinitions` / `getProductToolkitDefinition` +
  `planAttributeSync` / `applyAttributeSync`. Reachable from the viewer's toolbar as well as from
  Admin, scoped to the open category. Nothing changes here.
- **Values (new).** A "From ProductToolkit" panel: three-stage **scan → preview → apply**, through
  one classifier, matched on `akeneo_id`. Every one of PT's refusals-to-guess is carried over,
  because they are about data honesty and not about transport:
  - a value PT does not hold **leaves ours untouched** — nothing here ever proposes to *clear*;
  - a PT value whose attribute has **no local target** is listed as such, so a reported gap is not
    somebody hunting for something already there;
  - **our** `dataType` casts every incoming string, never PT's;
  - a SKU number naming **two records** proposes nothing until a person picks which record;
  - "known but nothing captured" is counted apart from "unknown".
- **Unreachable is an ordinary outcome, not an error.** PT is on an internal host behind an internal
  CA; the existing `ProductToolkitUnavailableError` already explains the three causes in order and
  its message is worth keeping verbatim. Every PT-dependent control degrades to "unavailable — you
  can still work here", never to a broken screen.

### Phase 8 — Outbound export, all-or-nothing

Only if there is a downstream consumer. If there is, keep PT's rule — *a partial file handed over
with a list of warnings is one somebody imports anyway, landing half the work and silently dropping
the rest* — and keep it because it is true of **any** import target:

- One row per SKU, only the **changed** attributes become columns (a file listing all 67 blanks the
  ones with no value in it), every metric carrying its own unit column.
- **One value the target would reject blocks the whole export**: no file, only a list naming the
  SKU, the attribute and the remedy.
- What blocks it, minus everything Akeneo-specific: an invalid option value · a non-numeric value in
  a numeric field · a value whose unit cannot be determined · **a SKU number that names two
  records**.
- The **to-push panel is one row per change**, not per SKU — that is the unit of work, and a wide
  per-SKU table has to be re-read to find which of 67 columns moved.

#### Phase 8 — done (2026-09-08), and it found two silent failures

Built even though §7.3's "is there a downstream consumer?" is still unanswered, because the
*validation* half is worth having regardless: it applies to the export that already exists and
ships today.

| File | What it is |
|---|---|
| [export-validation.utils.ts](../src/components/products/attribute-grid/export-validation.utils.ts) | the four blockers, and the store-sourced row builder — pure |
| [export-validation.utils.test.ts](../src/components/products/attribute-grid/export-validation.utils.test.ts) | 23 tests |
| [ExportBlockedDialog.tsx](../src/components/products/ExportBlockedDialog.tsx) | what you get instead of a file |

**Two ways the old export failed silently, now hard blockers:**

1. **Two attributes resolving to the same column.** `buildAkeneoRows` does
   `if (seen.has(code)) continue` — it keeps the first and drops the rest, so an entire
   attribute's values were absent from the file with nothing said. `akeneoColumnCode` falls back
   to a slug of the name, so "Product Width" and "product width" collide, as do any two
   attributes sharing an `akeneo_id`. That is data loss dressed as a successful export.
2. **Two SKU records sharing an item number.** The consumer keys on the number, receives two rows
   it cannot tell apart, and keeps whichever it reads last. Which record wins is not something
   this file gets to decide, so it refuses.

Plus the two the plan already named: an **invalid value**, and a **unit conflict** — values stored
in two different units for one attribute, or all in one unit that disagrees with the attribute's
declared one. That is the cable-length lesson: one column carries one unit, so mixed units get
rescaled by a hundred in a file that imports without a complaint.

**Other changes:**

- **The export now builds from the row store, not the JSONB mirror.** The mirror is a lossy
  derived copy refreshed by every write; handing a downstream system second-hand data is fine
  until the day the mirror is briefly behind, and then it ships stale values with no sign
  anything was wrong.
- **A column nothing fills is left out entirely**, because many importers read a blank column as
  "clear this field for every product". The toast says how many of the category's attributes
  actually carried a value.
- **There is deliberately no override.** The dialog offers "copy this list" so the problems can
  be pasted into a ticket, and nothing else. Every blocker carries its own remedy — a refusal
  that does not say what to do is just an obstacle.
- **A regression caught in review, worth recording.** The first cut of `buildExportRows` lost the
  **CSV formula-injection guard** the old builder carried: a supplier-submitted value beginning
  `=`, `-`, `@` or a tab reaches this export verbatim once somebody saves it, and the CSV writer
  quotes commas but not that — it runs as a formula the moment Excel opens the file. Restored and
  pinned by tests, including the deliberate exemption that leaves a **signed number** (`-5`,
  `+3.2`) alone, because quoting it would turn a real measurement into text.
- **`buildAkeneoRows` was deleted rather than kept as a fallback.** It was down to one caller
  (this export) and then none, and it carries the silent column-drop above. Leaving it in the
  barrel would leave that failure one import away. `akeneoColumnCode` survives — the validator
  depends on it — with tests that now pin the *collision* it can produce.

`tsc --noEmit` clean, `vite build` clean, **1,941 tests pass**.

**Total: ~17–21 engineering days**, of which Phases 0–4 (~9–10 d) deliver the merged screen and
Phases 5–8 the rest.

---

## 4. Deliberately omitted (the Akeneo half)

Nothing below gets built, and none of it is a loss, because OriginFlow holds both vocabularies:

| PT machinery | Why it goes |
|---|---|
| `akeneo.js` in full — `fetchProductValues`, `describeAttributes`, `fetchChoices`, `fetchChoiceMaps`, `fetchTableRows` | The value source is `sku_attribute_values`; type, options and unit are already declared by `category_attributes` |
| The `422`-over-one-bad-code absorber | Nothing rejects a whole request over a stale code when the read is a local join |
| Reference-entity vs single-select discovery | There is one option model: `validationRules.enumOptions` |
| Option **code** ↔ **label** folding | One vocabulary. Off-list values already render `invalid` |
| `akeneo_snapshot` / `diverges` / `checked_at` and the 8-state cell vocabulary | Collapses to the four states in §1 |
| `fetchMeasurementFamilies` | The unit travels with the value (§2.1); no symbol→code table needed |
| Family attributes, family inheritance, variant groups, model-level attribute checks | Akeneo product-model concepts with no OriginFlow counterpart |
| The 1,628-attribute catalogue read + 30-minute cache + type-ahead over it | A local `ILIKE` over ~99 rows. No `contains`-filter limitation to work around |
| "Find what it populates" (sampling Akeneo to draft a definition) | Replaced by the PT definition pull, which is already curated |
| `openReads.js` / the unauthenticated cross-origin GET | Not needed in either direction: the definition read is a local query |
| The Akeneo `product_changes` table attribute | No OriginFlow equivalent. `sku_change_log` is the per-SKU narrative and it is better |

**Kept from PT's Akeneo-adjacent work, on purpose:**

- The **option conversion matrix** concept (pinned / by-label / by-code / inferred / **ambiguous,
  reported rather than picked**) is *not* built now, but is the right answer the moment OriginFlow
  must talk to any external system — a shop feed, a marketplace, a retailer's spec sheet. Noted here
  so it is re-derived from PT rather than reinvented worse. Table shape would be
  `category_attribute_option_map (attribute_id, our_option, external_option, pinned_by, pinned_at)`,
  on the **attribute** so mapping a global one once maps it everywhere.
- **`akeneo_id` as a column.** It is the join key to PT and the only stable external code an
  attribute has. Relabelled, not removed.

---

## 5. Rules carried over verbatim

From [originflow-port-three-modules.md](originflow-port-three-modules.md) §6, the ones this module
must honour, each with where it lands here:

1. **A refresh must never overwrite what a person typed** — make it structural. The PT value pull is
   preview-then-apply and never proposes a clear (Phase 7).
2. **Show the items you can't see properly** — the union SKU source (Phase 0), duplicate-number
   records shown as two columns, categories with no definition listed and marked.
3. **Never let a slow upstream sit on a request path** — EPREL after render; PT only on click.
4. **An export is all-or-nothing** (Phase 8).
5. **Distinguish "checked and absent" from "not checked"** — `empty` vs `cleared`; an EPREL axis
   that has not been fetched says so rather than showing agreement.
6. **Refuse to guess, and say what you refused** — the five PT-import refusals; ambiguous options
   reported; no EPREL pre-fill without a safe equivalent.
7. **Status is hue *and* a label**, and an active filter is visible even when its panel is collapsed.
8. **Two visually distinct kinds of link** — if a shop/EPREL link is added, an arrow for a page that
   exists and a magnifier for a search. A search link must never read as evidence.
9. **State the age of the data** — the header strip says how each axis was read and when
   (values: live local; EPREL: fetched 14:20; PT: pulled 2 d ago / not connected).
10. **Order is the rendered order** — `sort_order` is the position in the flattened list, already
    true in the Admin editor; do not add a second source of truth about position.

---

## 5a. Integrity sweep (2026-09-09)

Three bugs had already been found by reviewing this work rather than by testing it — two write
paths that bypassed the row store, `setSkuFinal` never writing `reopen_reason`, and a dropped CSV
guard — so the whole value pipeline was audited for more of that class. Two audits: every WRITER
of the JSONB mirror, and every READER of it.

### Writers — clean

**No bypasses remain.** Every path that writes `project_skus.attribute_values` goes through
`updateProjectSku`, `createCatalogSku` or `bulkUpsertCatalogSkus`, all of which sync the row
store. Checked and cleared: the supplier-portal submission RPCs (`submit_attribute_request_secure`,
`submit_attribute_batch_secure`), the RFQ RPCs, `create_supplier_proposal_secure`, the IM
placeholder wizard, and every `SECURITY DEFINER` function in `db_migrations` — none of them touch
`project_skus` at all. They write `project_attribute_requests.submitted_data` and
`rfq_entries.attribute_responses`, which are separate tables.

### `160_final_sku_mirror_lock.sql` — the lock held on only one of two tables

**Found by audit, fixed, applied and verified.** Migration 158 stopped a Final SKU's values being
changed in `sku_attribute_values`. Nothing stopped them being changed in
`project_skus.attribute_values` — and ProjectDetail's SKU editor writes exactly that, with **no
`isFinal` check anywhere in the file**. So a signed-off SKU could still be edited there, and the
failure was invisible:

1. the JSONB write succeeded, unguarded;
2. the row-store sync that follows hit 158's trigger and raised;
3. that raise was caught and logged, because a secondary sync must not fail a SKU save.

The result was a signed-off product whose two stores disagreed, with only a console line to say
so — the Attribute Viewer showing the old values, the project screen the new ones, neither marked
suspect. *A lock that holds on one of two tables is not a lock.*

The trigger is scoped to `attribute_values` via a `WHEN` clause, because everything else about a
Final SKU must stay writable: `markSkusExported` stamps `pending_export`/`last_exported_at` on
Final SKUs (only Final SKUs are exportable), and the unlock path has to be able to run. Verified
live in a rolled-back block: mirror writable while open · **write on Final raises** · export stamp
on Final still allowed · unlock then writable again. ProjectDetail now shows a **Final** chip
instead of Edit, and disables Delete, so nobody fills in sixty fields before the refusal.

### Readers — one genuine cross-screen inconsistency, NOT fixed

A cleared cell (`value IS NULL`) mirrors into the JSONB as `''`, and **every** JSONB reader treats
that identically to "never touched" — `getEffectiveSkuValue` / `collapseSkuAttributeValues` and
their callers in ProjectDetail, `CreateComplianceRequest`, `ProjectIMGenerator` and the IM
placeholder service. So the Attribute Viewer shows `cleared` where those screens show a blank with
no signal.

This is **not a regression** — before migration 155 there was no "cleared" concept at all, so
nothing that used to work has stopped. It is newly-available information that these consumers do
not yet use. Assessed per consumer:

| Consumer | Does the distinction matter? |
|---|---|
| **Supplier / compliance request prefill** (ProjectDetail, CreateComplianceRequest) | **Yes — this is the one worth fixing.** A field somebody deliberately marked as "this product has none" re-prefills as blank, so the request silently asks a supplier again for data a person already decided does not apply. |
| IM placeholder wizard | Mildly. A cleared attribute reads as "no data" rather than a confirmed "N/A" — usually the desired document behaviour anyway. |
| **ProductToolkit readback** (`netlify/functions/sku-attributes.ts`) | **No.** `buildSkuAttributePayload` omits blank values whatever the cause, and for "what should we push" both cases correctly mean "send nothing". Data is current, not stale: `patchMirrors` runs inside every row write, so the mirror is lossy rather than lagging. |

**Resolved 2026-09-09** — decision taken: do not re-ask, and show the PM that the field was
cleared. Built as [164_request_not_applicable_attributes.sql](../db_migrations/164_request_not_applicable_attributes.sql)
(applied) plus `getClearedAttributeIds`, a panel in ProjectDetail's request modal, and a filter in
both supplier portals.

The fix is **not** in the prefill list, which is where it looks like it should be: a cleared field
has no value to prefill, so it was never the prefill that re-asked. The supplier *form* asks for
every supplier-visible attribute of the category, so the field came back round as a question with
nothing to seed it. What had to change is which fields the form asks for.

**Recorded on the request, as a snapshot.** `project_attribute_requests.not_applicable_attribute_ids`
holds the set as it stood when the request was created. A live lookup at render time would have
been less code and wrong: a request is a record of what was *asked*, so clearing another field next
week must not change an existing form under the supplier, and a submitted request must still show
what the question was. An empty array — every request created before this — correctly reads as
"asked for everything".

**Shown to the PM, not silently applied.** The request modal lists the excluded fields with a
"ask for them anyway" checkbox, off by default. Excluding fields from what a supplier is asked is a
decision worth seeing before it is made, and the person sending the request may know the record is
out of date. The supplier sees only a count, never the internal reasoning.

**A field that already has a submitted value is still shown**, even when excluded — hiding a value
the supplier already gave would read as data loss.

**The batch portal hides a field only when EVERY SKU in the batch marks it not applicable** —
confirmed as a decision, not a limitation to fix later. Its table renders attributes as rows shared
across every SKU column, so a field cannot be hidden for one SKU and shown for another without
restructuring it. The unanimous rule errs toward asking: a supplier occasionally sees a field that
does not apply to one of several products, which is the lesser harm than not asking for data a SKU
in the batch genuinely needs.

The other three consumers in the table above are unchanged: the IM wizard's behaviour is usually
what is wanted anyway, and the ProductToolkit readback correctly collapses both cases to "send
nothing".

**One documentation error corrected:** three comments (written during Phase 1) listed "the RFQ
builder" as a mirror consumer. It is not one — `CreateRFQ`'s `attributeValues` is unrelated local
state holding the RFQ's own attribute *requirements*. A wrong list of who depends on the mirror is
precisely what would make retiring it dangerous later, so the comments now name the real
consumers.

## 6. Known divergences from PT, accepted

- **Required-ness is per attribute, not per category.** PT keeps `required` on the
  category↔attribute link; OriginFlow keeps it in `validationRules.required` on the attribute, so a
  global attribute required in one category is required in all of them. Same for `wizardTier`.
  Fixing it means a `category_attribute` link table — a larger change than this merge, and the
  wizard depends on the current shape. **Flagged, not fixed.** The required-gap count is therefore
  slightly over-inclusive on global attributes; the tile should say "required (global rules apply
  everywhere)".
- **No warehouse/product cache.** OriginFlow's SKU population is what OriginFlow knows, so PT's
  *"include every non-discontinued warehouse item, flag the unmaintained ones"* scope rule has
  nothing to draw on. Phase 0's union is the closest honest equivalent; the "not in any project"
  tile is the gap-finding surface. If a warehouse mirror is ever added, PT §3.6 step 4(a) is the
  design to copy.
- **No `product_changes` narrative band.** `sku_change_log` covers it and is per-field.

---

## 7. Sign-off needed before Phase 1

1. **Retiring `/products`.** Phase 3's checklist is a gate, but the decision to delete an 845-line
   page that is currently in Super-Admin test needs an explicit yes.
2. ~~**Applying 155–158 to live.**~~ **Done 2026-09-08**, all checks passed — see "Phase 1 as
   built" above. The backfill inserted zero rows as predicted, because every existing JSONB entry
   is a blank placeholder. Rollback, if ever needed, is `drop table sku_attribute_values` plus the
   four trigger functions. The checks that were run:

   ```sql
   -- 4 policies, all on authenticated, all going through can_see_project
   select policyname, cmd from pg_policies
   where schemaname='public' and tablename='sku_attribute_values';

   -- 4 triggers across the two tables
   select tgname, tgrelid::regclass from pg_trigger
   where not tgisinternal and tgrelid in ('public.sku_attribute_values'::regclass,
                                          'public.project_skus'::regclass);

   -- expected: 0 (see finding 1)
   select count(*) from public.sku_attribute_values;

   -- the Final lock and the audit, verified rather than assumed:
   --   1. pick a non-final SKU, insert a value row, confirm one 'value' row appears in
   --      sku_change_log with the attribute's NAME in `field` and the actor filled in
   --   2. set that SKU is_final = true, confirm finalized_at/finalized_by got stamped
   --   3. attempt another value write on it, confirm it raises rather than succeeding
   --   4. unlock it, confirm finalized_at/finalized_by cleared and the write now works
   ```
3. ~~**Whether Phase 8 has a consumer at all.**~~ **Answered 2026-09-09: nothing downstream.**
   Somebody downloads the CSV and works from it. So Phase 8 is complete as built — the value was
   never the file, it was the refusal to produce a wrong one — and no further export work is
   warranted. If a consumer appears later, the option-conversion matrix in §4 is the thing to
   revisit first.
