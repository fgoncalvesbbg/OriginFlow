# Roadmap Creator — implementation plan

**Status (2026-09-09):** Phases A-E complete. **Migration 167 IS APPLIED** (live-verified — see
the Phase A gate). The module is **feature-complete** at `/roadmap`, still Super-Admin-only.
All four tabs are built. Only **Phase F (launch)** remains, and it is a decision, not code: remove
`/roadmap` from `SUPER_ADMIN_ONLY_PATH_PREFIXES`. Not done unilaterally — the module has never been
opened in a browser against real data.

---

## Context

`docs/originflow-port-three-modules.md` specified three ProductToolkit modules to bring into
OriginFlow: **Attribute Viewer**, **SP Matrix** and **Roadmap Creator**. Attribute Viewer shipped
(`/attributes`, migrations 155–158). The other two never did — and nothing in the repo records
that, which is why the module reads as "missing" rather than "deferred". That port doc's §5 put
Roadmap Creator **first** in the order of work ("no Akeneo work at all… delivers value in days");
it is the one that got skipped.

What the module does: pivot the product catalogue into a per-category roadmap grid, mark what is
being replaced or retired, plan the gaps with placeholder cards, and present the whole thing to a
supplier in the room **with the economics hidden**. The spec is `originflow-port-three-modules.md`
lines **140–386** — features (§1.1), build (§1.2), full UI/UX (§1.3), dependencies (§1.4), port
notes (§1.5). Read those before starting; this plan does not restate them.

### Verified starting state (2026-09-09)

| Fact | Verified how |
|---|---|
| **Zero roadmap code in OriginFlow.** No route, nav entry, page, service, or type. | `find`/grep across `src/`, `App.tsx` route table, `Layout.tsx` nav arrays |
| **Zero roadmap tables in the live DB**, `public` or `private_archive`. | `information_schema.tables` on `ecueltibpmpnhnaxlskx` |
| **The source code is on disk**: `~/Desktop/Git/ProductToolKit/ProductToolkit/src/apps/roadmap/` (7,061 LOC) + `server/apps/roadmap/` (2,006 LOC). | direct inventory |
| **`xlsx`, `html2canvas`, `jspdf` are already OriginFlow dependencies.** No new deps needed. | `package.json` |
| **Jira already works in OriginFlow**: `netlify/functions/jira-status.ts` + `src/services/project/jira.service.ts`. | existing code |
| `is_design_editor()` exists as a `STABLE SECURITY DEFINER` SQL function reading `public.user_roles`; `can_see_project(uuid)` likewise. | `pg_get_functiondef` |
| `user_roles` holds 6 rows, roles `admin` / `internal`. `profiles.role` holds `ADMIN` / `pm`. | live query |
| tsconfig has `allowJs: true`, `jsx: "react-jsx"`, **and no `strict`** — so a `.js` → `.ts` rename is nearly free (no `noImplicitAny`). | `tsconfig.json` |
| Vitest `include` is `src/**/*.test.ts(x)` only, `environment: 'node'`, **no jsdom** — `.test.js` files are not collected and component tests cannot run. | `vite.config.ts:13-16` |

### The one guarantee this module exists to provide

From §1.2, and it survives the port unchanged:

> A refreshed export can **insert and update** reference rows but can **never delete** one, and
> never touches an annotation table at all. A SKU that drops out of a newer export is marked
> `is_current = false` and still renders, dimmed, so the EOL note somebody wrote against it is not
> silently lost.

Three lines of defence hold it up, and all three must be carried over deliberately:
1. the import statement has **no delete branch**,
2. there are **no foreign keys** between annotation tables and `roadmap_sku`,
3. the delist pass is **guarded on a non-empty payload**, so a failed parse can't delist the catalogue.

---

## Decisions

**1. Its own reference table — not a join to `project_skus`.**
The board is built from commercial data (`Est. Factory Price`, `NOV_2025/26`, `ASP`, `SM%`,
claim rate) that exists **only in the `ProductFactoryPrices_Analysis` workbook**. `project_skus`
is the attribute catalogue and carries none of it. Keeping `roadmap_sku` separate is also what
makes defence #1 above expressible: the import names one table and one table only. A later join
on `sku_number` can feed the compare panel (see decision 6).

**2. The import is a Postgres RPC, not client-side writes.**
The `db` port (`src/data/ports/database.port.ts`) has no transaction primitive, and the upsert +
delist pass must be atomic or a mid-flight failure delists the catalogue. So the whole import
becomes **one `plpgsql` SECURITY DEFINER function** called through `db.rpc(...)` — the escape
hatch `PORTING.md` already documents for exactly this.

This also lets the **stage table go away**. `jsonb_to_recordset` over the payload replaces
`roadmap_sku_stage` entirely, which removes the source's `TRUNCATE` (needs table-owner rights on
Supabase) and the `mssql` bulk-load dependency. 6 tables, not 7.

**3. `INSERT … ON CONFLICT` in place of `MERGE`.** It has no delete branch *by construction*,
so the guarantee gets stronger, not weaker. Two translation gotchas:
- `$action` does not exist. Get insert-vs-update counts from **`RETURNING (xmax = 0) AS was_insert`**
  inside a CTE, counted in the outer query.
- `ON CONFLICT` **errors** if the same key appears twice in one statement
  (`cannot affect row a second time`). The source dedupes in `mapping.js:71-74`
  (`toStageRows`, last-one-wins). **Keep that dedupe** — do it in the payload builder *and*
  defensively with `DISTINCT ON (sku)` in the function.

**4. Writes gated by RLS, not by a positional middleware.** The source's single
`requirePermission("roadmap","editor")` barrier at `routes.js:134` becomes a new
`is_roadmap_editor()` function + per-table policies. RLS makes the barrier structural: a policy
cannot be "left off the bottom of the file" the way a route can. Mirror `is_design_editor()`
exactly — `sql`, `STABLE SECURITY DEFINER`, `SET search_path TO ''`.

**5. Ship `styles.css` verbatim — do not rewrite to Tailwind.**
All 1,642 lines are scoped under `.rdmp-root` and every `var(--…)` it reads it also defines
itself (checked: 28 references, 28 local definitions). It collides with nothing and needs no
tokens from OriginFlow. Rewriting is a real project, not a cleanup: the board is a wide dynamic
CSS Grid with per-family column bands, and `RoadmapGrid`/`StepUpChart` compute inline positions
the CSS cooperates with. Three rules encoded in it are load-bearing if anyone ever does convert:
coral is a **fill only** (accent-as-text uses indigo `--link`); the five status hues are a
**separate vocabulary** from the action colour, so *Replace* is indigo — specifically so
"selected" can never read as "this is a Replace SKU"; and status is always **hue + a text label**.

**6. Drop `AttributeComparePanel.jsx` in phase 1.** Its 248 lines call the Attribute Viewer's
`/apps/attribute-viewer/compare` route, which does not exist here. It is already lazy and behind
a collapsed section, so removing it is invisible. Phase 5 optionally repoints it at
`project_skus` / `sku_attribute_values` — a local read, per port doc §4.4.

**7. Rename `.js`/`.jsx` → `.ts`/`.tsx` on the way in.** There are currently **zero** `.jsx`
files in `src/`; adding 16 would be a visible break in convention. With `strict` off and
`allowJs` on, the rename is cheap. It is also *required* for the tests: vitest only collects
`src/**/*.test.ts(x)`, so a `.test.js` left as-is silently never runs — the worst possible
outcome for the ~760 LOC of pure-logic tests that are the most valuable thing in the port.

---

## Migration 167 — `167_roadmap_creator.sql`

Six tables. Source DDL is `server/apps/roadmap/schema.sql` (308 lines, T-SQL); translation rules:
`NVARCHAR` → `text`, `DATETIME2(3)` → `timestamptz`, `BIT` → `boolean`, `IDENTITY` →
`generated by default as identity`, `attrs_json`/`before_json`/`after_json` → **`jsonb`**.

```
REFERENCE (written only by the import)     ANNOTATIONS (written only by a person)
  roadmap_import   one row per upload        roadmap_item_flag   per-SKU mark + comment + status
  roadmap_sku      one row per SKU           roadmap_placer      one placeholder in one cell
                                             roadmap_axis_value  hand-added family/row/column
                                             roadmap_audit       append-only
```

Column-for-column from `schema.sql`:

- **`roadmap_import`** — `import_id` identity PK, `file_name`, `row_count`, `inserted_count`,
  `updated_count`, `delisted_count` (all `int not null default 0`), `imported_at timestamptz not
  null default now()`, `imported_by text`. Index on `(imported_at desc)`.
- **`roadmap_sku`** — `sku text primary key`, `description`, `family`, `system_index`,
  `image_url`, `supplier`, `shop_link`, `amazon_link` (text); `factory_price numeric(18,4)`;
  `attrs_json jsonb`; then the 14 metric columns per `schema.sql:70-93` —
  `nov_2025`, `nov_fc_2025`, `fc_ff_2025`, `noq_2025`, `sm_pct_2025`, `asp_2025`,
  `claim_rate_2025` and the same seven for `_2026`, with the source's precisions
  (`numeric(18,2)` / `(18,6)` / `(18,4)`); lifecycle `is_current boolean not null default true`,
  `first_seen_at`, `last_seen_at`, `last_import_id int`, `updated_by text`.
  Index on `(system_index)`.
  **`last_import_id` gets no FK** — see below.
- **`roadmap_item_flag`** — `sku text primary key`, `flag text` (`replace|eol|aeol|upcoming|null`),
  `comment text`, `updated_at`, `updated_by`, `status text not null default 'pending'`,
  `approved_by text`, `project_code text`.
  Skip the source's dead `approved boolean` column (`schema.sql:158-163` says it is superseded by
  `status` and unused).
- **`roadmap_placer`** — `placer_id` identity PK, the 6-part cell address
  (`category`, `y_field`, `x_field`, `family`, `y_value`, `x_value`, all `text not null`),
  `type text not null` (`new|upcoming`), `comment`, `sort_order int not null default 0`,
  `created_at`/`created_by`/`updated_at`/`updated_by`, `project_code`,
  `status text not null default 'pending'`, `approved_by`,
  `expected_2027_nic numeric(18,2)`. Index on `(category)`. Drop the dead `approved` column.
- **`roadmap_axis_value`** — `axis_value_id` identity PK, `kind text not null`
  (`family|row|col`), `category text not null`, `field text` (null for a family),
  `value text not null`, `created_at`, `created_by`.
  **Keep both partial unique indexes** from `schema.sql:262-284`:
  `(category, kind, value) where field is null` and
  `(category, kind, field, value) where field is not null`. A single 4-column unique index does
  not work: Postgres treats NULLs as *distinct*, so it would permit duplicate families.
- **`roadmap_audit`** — `audit_id bigint` identity PK, `entity text not null`
  (`flag|placer|axis|import`), `entity_key`, `action text not null`
  (`set|clear|add|remove|edit|import`), `category`, `sku`, `before_json jsonb`,
  `after_json jsonb`, `changed_at timestamptz not null default now()`, `changed_by text`.
  Indexes `(category, changed_at desc)` and `(changed_at desc)`.

**No foreign keys anywhere in this schema.** The source has zero, deliberately: a flag must
outlive the SKU vanishing from an export. Adding `roadmap_item_flag.sku → roadmap_sku.sku` would
break the module's whole reason for existing. Add a header comment saying so, because it looks
like an omission.

`CHECK` constraints on the enum-ish columns are a small **improvement** over the source (which
validated only in `routes.js`) and are safe to add — the values are closed sets defined in
`config/constants.js`. Add them for `flag`, `status`, `type`, `kind`, `entity`, `action`.

### The import function

```sql
create or replace function public.roadmap_import_skus(p_rows jsonb, p_file_name text)
returns table (import_id int, row_count int, inserted_count int, updated_count int, delisted_count int)
language plpgsql security definer set search_path to '' as $$ … $$;
```

Body, in order:
1. `if not public.is_roadmap_editor() then raise exception … end if;` — a SECURITY DEFINER
   function bypasses RLS, so it must re-assert the gate itself.
2. Guard: `if p_rows is null or jsonb_array_length(p_rows) = 0 then raise exception 'empty import'`.
   **This is defence #3** — without it a failed browser parse delists the catalogue.
3. Insert the `roadmap_import` row, capture `import_id`.
4. `insert into roadmap_sku (…) select distinct on (sku) … from jsonb_to_recordset(p_rows) as r(…)
   on conflict (sku) do update set <every reference column> = excluded.<col>, is_current = true,
   last_seen_at = now(), last_import_id = v_import_id, updated_by = v_actor
   returning (xmax = 0) as was_insert` — wrapped in a CTE whose outer query counts
   inserts and updates. **No delete branch. Ever.**
5. Delist: `update roadmap_sku set is_current = false where is_current and
   (last_import_id is null or last_import_id <> v_import_id)`.
6. Write back the three counts onto the import row; append one `roadmap_audit` row
   (`entity='import'`).

Actor comes from `auth.uid()` → `profiles.name`/`email` **server-side**. In the source, `actor`
travels as a request field (`RoadmapApp.jsx:57`, `usePlatform()`), i.e. client-asserted identity.
Do not carry that across — derive it in the function, and do the same in the write policies'
`*_by` columns.

### RLS

```sql
create or replace function public.is_roadmap_editor() returns boolean
  language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.user_roles r
                 where r.user_id = auth.uid() and r.role in ('admin','internal'));
$$;
```

- **Reads**: `to authenticated using (true)` on all six tables. There is nothing project-scoped
  here, so `can_see_project()` does not apply.
- **Writes**: `is_roadmap_editor()` on the four annotation tables. `roadmap_sku` and
  `roadmap_import` get **no write policy at all** — the only writer is the SECURITY DEFINER
  import function, which makes "reference data is written only by an import" a database fact
  rather than a convention.
- **`anon` gets nothing.** No portal, no token, no public read.

> **Open decision — who is an editor.** `user_roles` currently holds only `admin` and `internal`
> (6 rows) while `profiles.role` holds `ADMIN` and `pm`, and the roadmap's real audience is PMs
> and category managers. As written above, no `pm` can mark a SKU. Either add `pm`-equivalent
> rows to `user_roles`, or widen the function to
> `… or exists (select 1 from public.profiles p where p.id = auth.uid() and upper(p.role) in ('ADMIN','PM'))`.
> **Recommendation: widen the function** — it needs no data backfill and matches how the other
> ~30 policies key off `profiles.role`. Confirm before writing 167.
>
> **Approvers — decided 2026-09-09: the admins.** `constants.js:73` hardcoded
> `MANAGERS = ["Fabio","Nicolas"]`, duplicated in `server/…/mapping.js:20`, because ProductToolkit
> had no approver concept. Confirmed those two are the right approvers, and the rule is now
> derived rather than listed: **`profiles.role = 'ADMIN'`**, exposed by `roadmap_approvers()`.
>
> Verified live before choosing: `is_super_admin` is **one** person, so the plan's original
> suggestion would have been wrong. `profiles.role = 'ADMIN'` and `user_roles.role = 'admin'`
> resolve to the same four people (Fabio, Nicolas, Anabelle, Rahul); `profiles.role` wins because
> ~30 other policies already key off it.
>
> Two consequences worth keeping straight:
> - **Approving is narrower than editing.** `is_roadmap_editor()` includes PMs (they do the
>   marking); `roadmap_approvers()` does not. Two different rights, two different functions.
> - **`approved_by` stays a NAME, not a uuid**, and the `roadmap_validate_approver` trigger checks
>   it only when the value CHANGES. An approval is a snapshot of who decided — it must still read
>   correctly after that person is renamed, loses admin, or leaves. Same reasoning that keeps
>   foreign keys out of this schema, applied to people instead of SKUs.

---

## Port map

Landing under `src/pages/roadmap/` (page + presentational components + pure logic, matching how
`src/pages/design/` co-locates `design-spec-status.ts`) and `src/services/roadmap/`.

### Transfers essentially unchanged — the valuable half (~700 LOC + ~760 LOC of tests)

No React, no DOM, no I/O. Rename `.js` → `.ts`, fix what the compiler says, keep the tests.

| Source | Destination | Note |
|---|---|---|
| `lib/grid.js` (169) + `grid.test.js` (207) | `src/pages/roadmap/grid.ts` | **The union rule** — axis lists are the union of (1) values on the category's SKUs, (2) hand-added values, (3) **values referenced by an existing placer**. (3) is what guarantees every stored annotation has a cell to live in. Do not simplify. |
| `lib/chart.js` (153) + `chart.test.js` (240) | `src/pages/roadmap/chart.ts` | Pure ladder maths, one shared price scale, collision → drop a level. `CARD_H` 208 / `CARD_H_COMPACT` 140 are coupled to presentation mode. |
| `lib/parseWorkbook.js` (153) + test (138) | `src/pages/roadmap/parse-workbook.ts` | The only `xlsx` importer. Matches the 30 headers **by text** on the `Working Tab` sheet, never by position. |
| `lib/summary.js` (131) + test (125) | `src/pages/roadmap/summary.ts` | Plain-text change digest. |
| `lib/format.js` (62), `lib/search.js` (18) + test (48) | `src/pages/roadmap/format.ts`, `search.ts` | `search.ts` needs `searchByTerms` inlined (14 LOC, decision below). |
| `server/…/mapping.js` (221) + `mapping.test.js` (245) | `src/services/roadmap/roadmap-mapping.ts` | Row↔object translation moves **client-side**, since there is no Express layer. Keep `num()` (finite-or-null, comma decimals) and `text(v, max)` (truncate to column width, so one over-long description can't fail a 2,500-row import). Keep `toStageRows`' sku dedupe — decision 3 depends on it. |
| `config/constants.js` (94) | `src/pages/roadmap/roadmap.constants.ts` | `AXIS_FIELDS` (7), `REQUIRED` (30 headers), `ITEM_FLAGS`, `PLACER_TYPES`, `STATUSES`, `STATUS_LABELS`, `ALL_CATEGORIES`. `MANAGERS` is the one entry that gets replaced. |
| `server/…/import.guarantee.test.js` (146) | `src/services/roadmap/roadmap-import.guarantee.test.ts` | **Port this test.** It is the executable form of the guarantee. Rewrite its assertions against the new SQL: assert the function text has no `delete`/`not matched by source`, and assert the empty-payload guard rejects. |

### Rewritten

| Source | Destination | Work |
|---|---|---|
| `lib/api.js` (159) — 15 functions, the entire client/server contract | `src/services/roadmap/roadmap.service.ts` (+ `index.ts`, + a re-export block in `src/services/index.ts`) | The single seam. Components only ever see these 15 functions, so replacing `fetch`-to-Express with the `db` port is invisible above it. Follow `src/services/design/design-spec.service.ts` exactly: `import { db, orEmpty, type Row } from '../../data'`, `if (!isLive) return []` on every read, local `mapXRow` snake→camel mappers, throw on write failure, `orEmpty` on list reads. **Never import `@supabase/supabase-js` in a service.** Keep `ApiError`'s habit of surfacing the server's own message. |
| `server/…/routes.js` (375) + `repository.js` (711) | mostly **deleted** | 15 endpoints collapse to `db` port calls + RLS. `GET /board` was 4 recordsets in one round trip; here it becomes 4 parallel `db.select` calls in one `Promise.all` — still one wait. `GET /categories` becomes a `select system_index, count(*)` — needs a small SQL view or an RPC, since the port has no `group by`. `POST /import` → the RPC. `POST /clear` → two scoped deletes (keep it **per-category**; the prototype's bug was wiping all categories from a per-category screen). |
| `hooks/useBoard.js` (297) | `src/pages/roadmap/use-roadmap-board.ts` | Keep all three patterns: the **monotonic request-sequence stale guard** (`reqRef`) + `AbortController`, so fast category switching can't leave an old board on screen; **optimistic mutation with exact-snapshot rollback** (flagging happens dozens of times a sitting — a refetch per click makes the board feel like it is thinking); negative temporary ids (`-Date.now()`) for optimistic placers so they can't collide with a real identity value. Imports stay deliberately **non**-optimistic. |
| `GET /jira/epic` | reuse `src/services/project/jira.service.ts` | Already exists and already degrades. `netlify/functions/jira-status.ts` may need an epic-by-project-code mode; check before assuming. |

### Copied outright (small shared-platform bits)

| Source | Size | Destination |
|---|---|---|
| `shared/lib/textSearch.js` → `searchByTerms()` | 14 LOC | inline into `search.ts` |
| `shared/lib/useSearchCombo.js` | 72 LOC | `src/pages/roadmap/use-search-combo.ts` (its header notes it *originated* inside Roadmap) |

### Dropped

| Source | Why |
|---|---|
| `components/AttributeComparePanel.jsx` + `.test.jsx` (464) | Needs Attribute Viewer's Akeneo `/compare` route. Decision 6 — phase 5 at the earliest. |
| `shared/PlatformProvider` `usePlatform()` | Roadmap consumes exactly 2 of its ~25 values: `apiBase` (irrelevant with the `db` port) and `actor` (now derived server-side). |
| `shared/auth/sessionExpired.js` | Supabase session handling covers it. |
| `shared/db/pool.js`, `mssql`, `requirePermission.js`, `apps/registry.js`, `migrate.js` | No Express layer, no SQL Server. RLS replaces the permission barrier; migration 167 replaces `migrate.js`. |
| `roadmap_sku_stage` | Decision 2 — `jsonb_to_recordset` replaces it. |

### Components — `.jsx` → `.tsx`, otherwise as-is

`RoadmapApp.jsx` (725) and `SummaryTab.jsx` (375) are the only two over 300 lines. The rest are
presentational and small: `HistoryView` (244), `DetailPanel` (187), `RoadmapGrid` (178),
`ImportPanel` (176), `SkuCard` (138), `CategoryCombo` (109), `ChartFilters` (100),
`CompareCombo` (98), `StepUpChart` (83), `ActionMenu` (65), `PlacerCard` (47),
`SummaryPreviewPanel` (38). `RoadmapApp` becomes `src/pages/roadmap/RoadmapDashboard.tsx`.

`styles.css` (1,642) ships verbatim, imported once from the page root.

`lib/exportPdf.js` (130) + `download.js` (15) transfer as-is — already a **dynamic** import of
`html2canvas`/`jspdf`, so they stay out of the main chunk. Keep the `is-exporting` class that
paints first (hiding ⋮ buttons, unsticking headers) before the DOM snapshot, and
`crossOrigin="anonymous"` on card images — html2canvas needs it.

`lib/prefs.js` (31) — presentation mode in `localStorage` under `rdmp_hide_metrics`. Keep it
per-browser and persisted: a stray mid-meeting reload must not put the economics back on the
projector. Storage failure reads as "off".

### Wiring (the OriginFlow-side checklist)

1. `db_migrations/167_roadmap_creator.sql`, applied via Supabase MCP `apply_migration`, then
   **verified by introspection** — never from the file.
2. `src/types/roadmap.types.ts` + a re-export block in `src/types/index.ts` naming migration 167.
3. `src/services/roadmap/{roadmap.service.ts,roadmap-mapping.ts,index.ts}` + a re-export block in
   `src/services/index.ts`.
4. `src/app/App.tsx` — import + `<Route path="/roadmap">` inside `<ProtectedRoute>`, wrapped in
   `<SuperAdminRoute>` while under construction (the `/attributes` pattern, `App.tsx:142`).
5. `src/components/Layout.tsx` — one entry in `NAV_MODULES`:
   `{ to: '/roadmap', label: 'Roadmap Creator', Icon: Map, match: p => p.startsWith('/roadmap') }`
   (`Map` from `lucide-react`, matching the source registry entry).
6. `src/config/moduleAccess.config.ts` — add `'/roadmap'` to `SUPER_ADMIN_ONLY_PATH_PREFIXES`
   while WIP, plus a case in `moduleAccess.config.test.ts`. Remove at launch **with a comment
   saying why**, as `:36-40` does for `/design-specs`.

---

## Phases

Each phase ends with a gate. Record `Gate — passed <date>` in this file as the design-specs plan
does (`originflow-design-specs-module.md:342-420`).

**Phase A — schema + the guarantee.** Migration 167, `is_roadmap_editor()`,
`roadmap_import_skus()`, RLS on six tables. Port `import.guarantee.test.ts`.
*Gate:* introspect the live DB and confirm 6 tables, 0 foreign keys, both partial unique indexes,
and RLS enabled on all six. Call the import RPC twice with overlapping payloads and assert:
no reference row deleted, a dropped SKU flips to `is_current = false` and keeps its flag, a
reappearing SKU flips back with the flag intact, an empty payload is rejected, and a duplicate
`sku` in one payload does not error.

> **Gate — PASSED 2026-09-09.** Applied in two passes: the first attempt died on
> `ERROR: 40P01 deadlock detected` between `create trigger` on `roadmap_item_flag` and a
> concurrent Supabase-internal operation holding `storage.buckets`. **It did not roll back** —
> tables, policies and two of the four functions landed, `roadmap_approvers`,
> `roadmap_validate_approver` and both triggers did not. Finished statement-by-statement with
> `set local lock_timeout = '5s'`, which is the way to re-run this file if it ever happens again:
> the migration is fully idempotent, so a re-run is safe.
>
> Structure, introspected live: 6 tables · **0 foreign keys** · 42 CHECK constraints · 13 indexes
> including **both** partial unique indexes · RLS on all 6 · 10 policies · 5 functions ·
> 2 approver triggers.
>
> Behaviour, exercised against the live database with three throwaway imports (data since deleted,
> sequences reset, all six tables back to 0 rows):
>
> | Assertion | Result |
> |---|---|
> | duplicate `sku` in one payload | 4 rows in, 3 inserted, **no error** |
> | SKU dropped from a refreshed export | row kept, `is_current` → false, `delisted_count` 1 |
> | its flag and comment | **survived intact** |
> | reference rows deleted, ever | **0** |
> | SKU reappears in a later export | `is_current` → true, flag still attached |
> | `first_seen_at` on an updated row | not bumped |
> | empty payload | refused, `22023`, and **the delist pass did not run** |
> | caller without an authenticated JWT | refused, `42501` |
> | `approved_by` = a non-admin | refused, `23514` |
> | `approved_by` = an admin | accepted |
> | editing an already-approved row | still allowed (no re-validation) |
>
> **One correction the gate caught.** Supabase's `alter default privileges` had granted `anon` AND
> `authenticated` all seven privileges on all six tables the moment they were created — including
> INSERT/UPDATE/DELETE on the two reference tables the migration claims are read-only. RLS denied
> all of it (every policy is `to authenticated`; anon has none), so it was never an open door, but
> the grant layer flatly contradicted the policy layer. Migration 167 now REVOKES first and then
> grants, and the live database was corrected: `anon` holds **zero** privileges on all six tables,
> `authenticated` holds SELECT on `roadmap_sku`/`roadmap_import` and SELECT+INSERT on
> `roadmap_audit`.

**Phase B — the pure layer.** Move `grid`/`chart`/`summary`/`format`/`search`/`parse-workbook` +
`roadmap-mapping` and their tests. No UI.
*Gate:* `npm test` — all ~760 LOC of ported tests collected (confirm the count went up; a
`.test.js` left unrenamed would be silently skipped) and green.

> **Gate — passed 2026-09-09.** `npx vitest run`: **120 files / 2264 tests green**, up from 114
> files / 2155 before the port — the 109 new tests are all collected, which is the thing that
> would have failed silently had the files stayed `.test.js`. `npx tsc --noEmit` clean.
> Landed: `src/types/roadmap.types.ts` (+ barrel), `src/pages/roadmap/{roadmap.constants,format,
> search,grid,chart,parse-workbook,summary}.ts` with `grid/chart/parse-workbook/summary` tests,
> and `src/services/roadmap/{roadmap-mapping,roadmap.service,index}.ts` (+ barrel) with the
> mapping and guarantee tests.
>
> Two deliberate departures from the source, both recorded in the code: `toImportRows()` emits
> **database column names** rather than the domain's camelCase, so the RPC does no cleaning and
> there is one place that decides what a cell means; and `applyFilters`/`bySupplier` return the
> input array **by identity** when nothing narrows it, which the source relied on and a naive
> `[...spread]` port would have silently broken (it re-lays-out the ladder every render).

**Phase C — service seam + board read.** `roadmap.service.ts`'s 15 functions,
`use-roadmap-board.ts`, `/roadmap` route + nav + super-admin gate, `RoadmapDashboard` shell,
`styles.css`, the grid, `SkuCard`, `PlacerCard`, `CategoryCombo`. Read-only.

> **Gate — code complete 2026-09-09, live check pending 167.** `npx tsc --noEmit` clean,
> `npx vitest run` **121 files / 2288 tests green**, and `npx vite build` succeeds (2,551 modules;
> `roadmap.css` folds into the 40 kB CSS bundle). Landed: `RoadmapDashboard.tsx`,
> `use-roadmap-board.ts`, `prefs.ts`, `download.ts`, `roadmap.css` (verbatim, 1,642 lines),
> `components/{SkuCard,PlacerCard,ActionMenu,RoadmapGrid,CategoryCombo,ImportPanel,SummaryPreviewPanel}.tsx`,
> plus the route in `App.tsx`, the `NAV_MODULES` entry in `Layout.tsx`, the `/roadmap` prefix in
> `moduleAccess.config.ts` and two cases in its test.
>
> Phase C and D were merged deliberately. Splitting them would have shipped a board whose ⋮ menu
> and "+ flag item" buttons did nothing — worse than not having them.
>
> Still unverified because it needs the migration: that a real workbook imports, that a board
> renders for a real category, and that `.rdmp-root` sits correctly inside OriginFlow's `Layout`
> (the CSS was written for a full-page app shell; it may need a containment rule).
*Gate:* import a real `ProductFactoryPrices_Analysis.xlsx` through the two-step
parse → preview counts → commit panel; a board renders for a real category; the honesty notes
appear ("*12 SKUs in this category hidden — no 'Main Color' or 'Segment 01' value*"); a
non-editor sees the board and gets a clean error, not a silent no-op, when they try to write.

**Phase D — annotations.** Flags, comments, placers, hand-added axis values, per-category clear,
`ActionMenu`, `DetailPanel`, jump-to-SKU, the supplier filter, presentation mode.

> **Gate — code complete 2026-09-09 except `DetailPanel`, live check pending 167.** Built with
> Phase C above. `DetailPanel` + `CompareCombo` + `useSearchCombo` slipped to Phase E: clicking a
> card currently does nothing, because the panel's whole job is side-by-side comparison, which is
> most of a tab in itself.
>
> A viewer who fails `canEditRoadmap()` gets NO ⋮, no "+ flag item" and no ✕ — the components drop
> those when the handler prop is absent, rather than rendering controls that would fail on RLS.
*Gate:* a mark survives a reload and a re-import. Presentation mode strips ASP / factory price /
SM% / the NOV table / the YoY badge / chart ticks / lane averages / the price band while keeping
identity and marks, and the ladder keeps its shape. The supplier filter is a **view** filter —
verify a mark applied under a narrowed view still targets the whole category. Verify
`/roadmap` is unreachable by URL for a non-super-admin.

**Phase E — chart, history, summary.** `StepUpChart` + `ChartFilters`, `HistoryView` (imports +
audit + **orphan report**), `SummaryTab` with status/approver dropdowns kept independent,
Project Code, the Jira column, `Expected 2027 NIC`, PDF + text export, "All categories" mode.
*Gate:* the orphan report names exactly the annotations that only the union rule's clause (3) is
keeping visible; setting an approver does not reset the status and vice versa; the Jira column
degrades to "not configured" rather than erroring; "All categories" shows a "pick one category"
notice on the board and chart while History and Summary work across everything.

> **Gate — code complete 2026-09-09, live check pending a real workbook.** `tsc --noEmit` clean,
> `vitest run` **2288 green**, `vite build` succeeds with `html2canvas` still in its own lazy
> chunk (the dynamic import survived the port). Landed: `StepUpChart`, `ChartFilters`,
> `HistoryView`, `SummaryTab`, `DetailPanel`, `CompareCombo`, `use-search-combo.ts`,
> `export-pdf.ts`, and the four-tab shell in `RoadmapDashboard`.
>
> Three deliberate improvements on the source, all recorded in the code:
> - **Jira is batched.** The source fired one request per Project Code cell. OriginFlow already
>   has `lookupJiraIssues` (60 codes per round trip, fails soft), so every code on the tab
>   resolves in one call. It still re-checks automatically when a code changes.
> - **Orphans are derived client-side** by `findOrphans`, which is already unit-tested, instead of
>   the source's `/orphans` endpoint. One less round trip and one less thing to keep in step.
> - **The approver dropdown is fed by `roadmap_approvers()`**, so it cannot offer a name the
>   trigger will reject. A name already on a row that is no longer an admin stays selectable and
>   is labelled as such, rather than silently reverting to "—".
>
> One bug the port caught: `SkuCard`'s ladder variant had been renamed `chart`, but the CSS only
> defines `.rdmp-card-step`. Every card on the Step-Up Chart would have rendered unstyled.
> Restored to `step`.
>
> Still unverified: the orphan report against real drifted data, the PDF export at real board
> size, and whether `.rdmp-root` sits correctly inside OriginFlow's `Layout`.

**Phase F — launch.** Remove `/roadmap` from `SUPER_ADMIN_ONLY_PATH_PREFIXES` (with the comment),
settle the editor role, update `docs/originflow-port-three-modules.md` with a status header
saying Roadmap Creator shipped and SP Matrix is still outstanding — the absence of that header is
how this module went missing in the first place.

> **Not started, and deliberately not done automatically.** Opening the module to every signed-in
> user is a product decision, and nothing here has been opened in a browser against a real
> `ProductFactoryPrices_Analysis` export yet. Do that first; the import panel is the front door.
>
> Checklist when launching: remove the prefix (leaving the comment that says why, as
> `/design-specs` does), flip the two cases in `moduleAccess.config.test.ts`, and add the status
> header to `docs/originflow-port-three-modules.md` recording that Roadmap Creator shipped and
> **SP Matrix is still outstanding** — the absence of that header is exactly how this module went
> missing for two months.

**Deferred / optional:** `AttributeComparePanel` repointed at `project_skus` +
`sku_attribute_values` (keep it lazy anyway; it costs nothing). Tailwind conversion of
`styles.css` — only if it ever earns itself.

---

## Verification

- **Tests:** `npm test` (vitest, `environment: 'node'`). Component tests from the source
  (`hideMetrics.test.jsx`, `CompareCombo.test.jsx`) **cannot run** — there is no jsdom or
  testing-library here, and 107 existing test files get by without them. Do not add jsdom for
  this port; re-express what those tests assert as pure-logic tests over the presentation-mode
  field lists instead.
- **Typecheck:** `npx tsc --noEmit` (and `npm run typecheck:functions` if any Netlify function
  is touched — it should not be).
- **Schema:** Supabase MCP `list_tables` / `execute_sql` against `information_schema` and
  `pg_policies`. Per `CLAUDE.md`, do not record applied-status claims in prose here — cite the
  object found.
- **Manual, with real data:** the acceptance path is one real workbook imported twice, with an
  annotation written between the two imports. If that annotation survives and the dropped SKU is
  dimmed rather than gone, the module works. Everything else is presentation.
