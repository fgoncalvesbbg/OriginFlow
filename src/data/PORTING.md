# Porting OriginFlow to another backend

This folder exists so that changing database vendor is a matter of writing **one adapter**
rather than editing the whole service layer. Nothing outside `src/data/supabase/` names
Supabase, and `boundary.test.ts` fails the build if that stops being true.

That gets you the *mechanical* part of a migration. It does not get you the hard part.
This document is the honest inventory of what is genuinely NOT portable, so the eventual
decision is made with numbers rather than optimism.

---

## 1. What a new adapter has to implement

Three interfaces, in `./ports`:

| Port | File | Size of the job |
|---|---|---|
| `DatabasePort` | `ports/database.port.ts` | 12 methods, 10 filter operators. Mechanical. |
| `AuthPort` | `ports/auth.port.ts` | 7 methods — but see §2, this is not the real cost. |
| `StoragePort` | `ports/storage.port.ts` | 4 methods. Mostly mechanical, one snag (§6). |

Then bind them in `./index.ts`. Two `DatabasePort` instances exist because the app has two
trust contexts:

- **`db`** — authenticated staff. Authorization is enforced *by the database* against the
  caller's JWT.
- **`portalDb`** — unauthenticated supplier portal. It may ONLY call `rpc()`; those routines
  authorize themselves from an opaque token. It must never gain direct table access.

The operator surface was measured against actual usage, not guessed. It is deliberately
minimal: `eq neq lt lte gt gte in isNull isNotNull arrayContains`, plus ordering, limit, and
a projection string. There is no `OR`, because nothing needs one.

---

## 2. The real cost: authorization lives in the database

**This is 80% of the migration and the ports do not help with it at all.**

- **108 `CREATE POLICY` statements** across 27 migration files
- **110 references to `auth.uid()` / `auth.jwt()`** inside those policies
- **~40 tables** with row-level security enabled

Today the browser talks to Postgres directly and is safe *only* because every table carries
policies that filter rows by the caller's JWT. Supabase Auth issues that JWT; PostgREST
forwards it; Postgres enforces it.

SQL Server has no equivalent. Its row-level security has no notion of a per-request
authenticated identity, and you would never expose SQL Server directly to a browser anyway.
So a migration requires:

1. **Building an API server.** There is no PostgREST equivalent to lean on. The natural shape
   is an HTTP implementation of `DatabasePort` — which is exactly why the port is declarative:
   a `{ table, where, order }` object serializes over the wire, a fluent builder chain does not.
2. **Re-implementing all 108 policies as server-side checks** in that API layer.
3. **Replacing the identity provider** (Entra ID / MSAL is the obvious internal choice) and
   reissuing whatever token the new authorization layer reads.

Satisfying `AuthPort` is a day. Rebuilding the authorization model those 110 `auth.uid()`
references represent is the project.

---

## 3. The 25 SECURITY DEFINER routines (`rpc`)

These are Postgres functions carrying the supplier-portal authorization rules. They run with
elevated rights and validate an opaque token themselves — that is what lets an unauthenticated
portal visitor read exactly one project and nothing else. **Every one must be re-implemented
by name**, with its security check intact.

Called via `portalDb.rpc()` (unauthenticated, token-scoped):

```
create_supplier_proposal_secure        get_rfq_by_entry_token
get_attribute_request_by_token         get_rfq_entry_by_token
get_attribute_requests_by_project_token  get_rfqs_for_supplier
get_attribute_requests_by_supplier     get_supplier_by_token_safe
get_compliance_request_secure          get_supplier_proposals
get_compliance_requests_by_supplier    submit_attribute_request_secure
get_compliance_requests_by_supplier_code submit_compliance_response_secure
get_im_share_by_token                  submit_rfq_entry_secure
get_production_updates_by_supplier      submit_supplier_production_update
get_project_by_token_secure            supplier_add_adhoc_document
get_projects_by_supplier_token         supplier_add_document_comment
                                       supplier_set_document_file
                                       verify_supplier_access
```

Called via `db.rpc()` (authenticated): `submit_production_update`.

⚠️ Getting one of these subtly wrong is a **data-exposure bug**, not a broken feature. Port
them deliberately, with tests, before anything else.

---

## 4. Embedded joins — the one place `columns` is not portable

`SelectOptions.columns` is a pass-through projection string. `'*'` and comma-separated column
lists are portable. **PostgREST embedded-resource syntax is a server-side join** and is not.
All 10 call sites, so the migration has an exact list rather than a search problem:

| Location | Projection |
|---|---|
| `services/shared/dashboard.service.ts` (×3) | `*, projects!inner(name)` |
| `services/project/sku-catalog.service.ts` | `*, projects(id, name, category_id)` |
| `services/project/sku-attribute-review.service.ts` | `*, projects!inner(id, name, category_id)` |
| `services/sourcing/rfq.service.ts` | `*, category_l3:categories_l3(name)` |
| `services/sourcing/rfq.service.ts` | `*, supplier:suppliers(name)` |
| `services/sourcing/supplier-proposal.service.ts` | `*, supplier:suppliers(name)` |
| `services/compliance/compliance-category.service.ts` | `*, pm:profiles!pm_id(id, name)` |
| `services/im/project-im.service.ts` | `project:projects(...)` + `template:im_templates(name)` |

`!inner` means INNER JOIN; without it, LEFT JOIN. The alias before the colon (`pm:`) is the
key the joined object lands under, and the mappers read it (`row.pm?.name`) — so a new adapter
must reproduce the **nesting shape**, not just the columns.

**One filter also targets a joined column**, which the port cannot express structurally:
`sku-attribute-review.service.ts` filters `{ 'projects.category_id': categoryId }`. A SQL
adapter must recognise dotted keys as qualified references.

---

## 5. Postgres-specific data types

| Construct | Count | SQL Server equivalent |
|---|---|---|
| `jsonb` columns | ~10 (`content`, `placeholder_data`, `attribute_values`, `resolved`, `features`, `responses`, `submitted_data`, `metadata`, `change_log`) | `nvarchar(max)` + `JSON_VALUE`/`OPENJSON`. **You lose JSONB operators and GIN indexing** — this will hurt IM templates and SKU attributes most. |
| `text[]` columns | 5 (`applicable_categories`, `placeholders`, `regulation_refs`, `languages` ×2) | No native arrays. Needs a junction table or JSON. This is what `arrayContains` maps onto (`@>` today). |
| `gen_random_uuid()` | 10 migrations | `NEWID()` (note: not sortable like a v4 UUID; consider `NEWSEQUENTIALID()` for clustered keys). |
| `ON CONFLICT` / upsert | `upsert`, `upsertReturning` | `MERGE`, or an explicit UPDATE-then-INSERT. Watch MERGE's concurrency caveats. |
| `RETURNING` | `insert`, `update`, `upsertReturning` | `OUTPUT` clause. |

There is **no pgvector** in this schema — an earlier scan matched the word "vector" in a
comment about vector PDFs, not a column type.

Also server-side and easy to overlook: **2 triggers** (supplier `portal_token` / initial
`access_code` auto-generation, and the migration-87 finalized-template write lock), **24
functions**, and **1 view** (`im_block_section_usage`, which `im-block.service.ts` reads as if
it were a table). The finalize lock in particular surfaces to the app as a *permanent* error —
see §7.

---

## 6. Storage

Four buckets: `documents` (private, signed URLs), `im-assets`, `im-published`, `im-print`
(public).

The awkward member is **`StoragePort.publicUrl` — it is synchronous**, because Supabase builds
the URL by string concatenation with no server round-trip. Several call sites use it inline in
mappers and return values.

An adapter fronting private Azure Blob containers **cannot implement it**, because a SAS URL
requires signing. If you go that route, either:

- keep a public CDN container for the three public buckets and preserve the synchronous shape, or
- change the port to make `publicUrl` async and update the ~8 call sites.

Decide this early — it is the one port change a SQL Server migration is likely to force.

---

## 7. Error classification is part of the contract

`src/services/core/save-retry.ts` decides whether to retry a failed write. It must never retry
a constraint violation and must always retry a timeout. It gets that from
`DataAccessError.kind`, which the **adapter** sets — see `supabase/errors.ts`, the only file in
the app that reads driver-native error codes.

A new adapter must classify its own driver's failures:

- `permanent` → SQL Server 2627/2601 (unique), 547 (FK), 515 (null), 245/8114 (conversion),
  and the finalized-template trigger's message.
- `notFound` → no row where exactly one was required (PostgREST's `PGRST116`).
- `transient` → everything else: timeouts, dropped connections, expired tokens, deadlock
  victim (1205 — genuinely worth retrying).

Get this wrong in the "permanent" direction and saves retry three times before failing. Get it
wrong in the "transient" direction and the IM editor hammers a doomed write.

---

## 8. Recommended order of work

1. Stand up the API server and port the **25 SECURITY DEFINER routines** first, with tests.
   They are the security-critical surface.
2. Re-implement the **108 RLS policies** as server-side authorization in that API.
3. Write `HttpDatabaseAdapter` against `DatabasePort` (the declarative query object
   serializes directly; this part is genuinely easy).
4. Translate the **10 embedded joins** into real JOINs preserving nesting shape (§4).
5. Swap the identity provider behind `AuthPort`.
6. Decide the `publicUrl` question (§6) and implement `StoragePort`.
7. Migrate data, converting `jsonb` → `nvarchar(max)` and `text[]` → junction tables.
8. Flip the four bindings in `./index.ts`. Delete `./supabase/`.

Steps 1–2 are the project. Steps 3–8 are the part this boundary made cheap.

---

## 9. If you need something the port doesn't have

**Do not** import a driver SDK outside `src/data/supabase/` — `boundary.test.ts` will fail,
and it is failing for a good reason.

Add the capability to the port (`ports/*.port.ts`) as an explicit, named variant, implement it
in every adapter, and if it is not portable, document it here. A raw filter-string or
passthrough escape hatch defeats the whole exercise: it is how a boundary becomes decorative
while still looking like a boundary.
