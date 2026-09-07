# Supabase audit — OriginFlow (`ecueltibpmpnhnaxlskx`)

**Date:** 2026-09-07 · **Method:** live queries against production (`pg_policies`, `pg_class`,
`storage.objects`, `information_schema`, Supabase advisors) plus a `SET LOCAL ROLE anon`
impersonation test. Repo `db_migrations/` was NOT trusted — it drifts from production.

**Scope answered:** (1) outdated / unused / duplicated tables, (2) whether file access
policies are correct and cannot be wrongly accessed.

**Headline:** there are no duplicated tables and only 6 genuinely dead ones. The file-access
side is where the problems are: **an anonymous caller can list and download every object in
4 of your 6 buckets — 485 files, including all 143 published manuals and all 101 print PDFs.**

---

## 1. Storage & file access

### S1 — CRITICAL · anonymous enumeration + download of 4 buckets

`storage.objects` carries policies granted to role `public` (which includes `anon`):

```
"im-assets public read"     SELECT  TO public  USING (bucket_id = 'im-assets')
"im-published public read"  SELECT  TO public  USING (bucket_id = 'im-published')
"im-print public read"      SELECT  TO public  USING (bucket_id = 'im-print')
"Public Read Access"        SELECT  TO public  USING (bucket_id = 'launchflow-docs')
```

Verified by running as `anon`:

| bucket | objects an anon caller can list | also `public = true`? |
|---|---|---|
| `im-assets` | 236 | yes |
| `im-published` | 143 | yes |
| `im-print` | 101 (301 MB of PDFs) | yes |
| `launchflow-docs` | 5 | yes |

Two separate doors, and both are open. The SELECT policy lets an unauthenticated caller
**enumerate every object path** via the storage list API; `public = true` then lets them
**download each path** with no token at all. Sample paths returned to `anon`:

```
im-published/10d8faba-fe29-4300-83bb-aeeec2dc77ed/im/en.json
im-print/10d8faba-fe29-4300-83bb-aeeec2dc77ed/im/im-en-a4-v1-1784291249909.pdf
```

They do not have to guess a project UUID — the list hands it to them. **The `im_shares`
token model is bypassed entirely**: every published manual and every print PDF for every
customer is retrievable by anyone who knows your project ref.

The signed-URL code to fix this is already written (`netlify/functions/im-file-url.ts`,
`storage.signedUrl`, `resolvePublishedUrl`) but the buckets were never flipped.

### S2 — HIGH · `launchflow-docs` is an abandoned, wide-open bucket

Public, **no file size limit**, **no MIME allowlist**, and an anon INSERT policy:

```
"Public Supplier Uploads"  INSERT  TO public
  WITH CHECK (bucket_id = 'launchflow-docs'
              AND (storage.foldername(name))[1] = 'supplier_uploads')
```

The string `launchflow-docs` appears **nowhere** in `src/`, `netlify/` or `scripts/`. It
holds 5 objects, last written 2026-02-06. So: a dead bucket that any anonymous person on
the internet can upload arbitrary files to — any size, any type, `text/html` included —
and receive a permanent public URL on your Supabase domain. That is a storage-cost vector
and a phishing / stored-XSS host in one.

### S3 — MEDIUM · `im-review-uploads` is public with zero policies

0 objects today. The *upload* half is done right — `netlify/functions/review-upload-url.ts`
validates the review token with the service role and mints a one-shot signed upload URL. But
the *read* half deliberately depends on the bucket being public:

```ts
// src/services/im/im-review-comments.service.ts:193
export const reviewImageUrl = (path: string): string =>
  storage.publicUrl(REVIEW_UPLOAD_BUCKET, path);
```

That is synchronous by design, so flipping the bucket is **not** a one-line SQL change — it
needs `reviewImageUrl` converted to an async signed-URL call first (the same shape as
`getSignedPrintPdfUrlForPath`), and every call site awaited. Cheap while the bucket is still
empty; it gets more expensive the moment suppliers start attaching screenshots, and until
then every attachment is world-readable to anyone who learns the path.

### S4 — MEDIUM · two policies target a bucket that does not exist

`"Auth Upload"` (INSERT) and `"Public Access"` (SELECT) both reference `bucket_id = 'images'`.
There is no `images` bucket. Dead rules — but a policy literally named "Public Access" sitting
in the list is exactly the kind of noise that hides a real finding.

### S5 — MEDIUM · unscoped anon INSERT into `documents`

```
"Anon users can upload documents"  INSERT  TO anon  WITH CHECK (bucket_id = 'documents')
```

No folder scoping, no token check. Any anonymous caller can write to any path in the private
`documents` bucket (capped by the 50 MB limit and the MIME allowlist). There is no anon
UPDATE or DELETE, so **existing files cannot be overwritten** — this is junk injection and
cost, not a data leak. The supplier portal does depend on it (`SupplierPortal.tsx:121` →
`uploadFile(docId, file, true, token)`), so the fix is to route it through a signed-upload
function the way the review portal already does.

### S6 — LOW · `documents` carries 9 policies, 4 of them redundant

The `Give users authenticated access to folder flreew_0..3` set duplicates the four
`Authenticated users can …` rules with an extra `private/` folder condition. Same effective
grant expressed twice.

### S7 — LOW · ~52 objects (119 MB) in `documents` look unreferenced

Matched loosely against `project_documents.file_url` + `document_versions.file_url`; 98 of
113 `project_documents` rows have a NULL `file_url`, so **this needs a precise match before
anyone deletes anything.** Treat as a lead, not a finding.

### What is already correct

- `documents` is private, MIME-restricted, 50 MB capped, and anon cannot list it.
- `im-assets` and `im-review-uploads` have MIME allowlists and size caps.
- `supplier-file-url.ts` enforces `is_visible_to_supplier` before signing.

---

## 2. Row-level security

### D1 — HIGH · `project_documents` anon SELECT is effectively unscoped

```
anon_select_visible_docs  SELECT  TO anon  USING (is_visible_to_supplier = true)
```

No project binding, no token binding. **111 of 113 rows** carry that flag, and running as
`anon` returns all 111. So any anonymous caller reads the document register of *every*
project — titles, descriptions, deadlines, statuses, supplier comments, project IDs — not
just the project whose token they hold.

The files themselves are safe: `documents` is private, 98 `file_url`s are NULL, and the 15
stored public-style URLs are dead now that the bucket is private. This is a metadata leak
across customer boundaries, which is still a confidentiality problem.

### D2 — MEDIUM · `document_comments` anon SELECT `USING (true)`

0 rows today, so nothing leaks right now. It is an open door waiting for data.

### D3 — MEDIUM · taxonomy readable without a login

`SELECT USING (true)` for role `public` on `categories_l1` / `l2` / `l3` (135 L3 rows),
`category_attributes` (93 rows), `compliance_requirements` (36 rows), `compliance_sections`,
`product_features`. Verified readable as `anon`. Your category and attribute taxonomy is
competitive product data.

### D4 — HIGH · 101 plaintext supplier access codes still stored

`db_migrations/146_stop_storing_plaintext_access_codes.sql` is **still not applied**.
`supplier_access_logs.access_code` holds 101 rows / 9 distinct 6-digit codes, and **3 of them
still match live rows in `suppliers`.** Any authenticated staff account can read them (the
SELECT policy is `auth.role() = 'authenticated'`); `anon` cannot. Separately, the anon INSERT
policy on that table is `WITH CHECK (true)` — unauthenticated log spam.

### D5 — LOW · 5 tables have RLS on and no policies

`template_steps`, `project_templates`, `template_documents`, `project_comments`,
`portal_access_attempts`. Only `portal_access_attempts` is deliberate (service-role-only rate
limiter). The other four are dead — see §3.

### D6 — LOW · 2 trigger guards have a mutable `search_path`

`im_sections_finalized_guard`, `im_templates_finalized_guard`. Migration 72 fixed the others
and missed these two.

### D7 — LOW · dead SECURITY DEFINER functions exposed to anon

`handle_tcf_submission` and `handle_tcf_submission_v2` are SECURITY DEFINER trigger functions
**attached to no trigger**, with EXECUTE granted to `anon`. Postgres refuses to invoke a
trigger function over RPC, so this is not directly exploitable — but it is dead surface that
the advisor will keep flagging.

The 38 other `anon_security_definer_function_executable` advisor warnings are the supplier /
compliance portal RPCs. Those are by design and are rate-limited by `portal_rl_guard`.

### What is already correct

- Every one of the 68 public tables has RLS **enabled**.
- Running as `anon`: `projects`, `profiles`, `im_shares`, `im_sections`, `im_templates`,
  `im_publish_snapshots`, `project_skus`, `im_print_renders`, `im_review_comments`,
  `notifications`, `prompt_library`, `ai_prompts`, `regulations`, `sku_change_log`,
  `feedback_reports`, `supplier_access_logs` all return **0 rows**.
- `suppliers`, `rfqs`, `rfq_entries`, `supplier_proposals`, `compliance_requests`,
  `project_attribute_requests`, `supplier_pm_assignments` have SELECT **revoked** from anon
  entirely — permission denied before RLS is even consulted.
- The August fixes hold: `enforce_profile_role_guard` is live and attached, and the
  `can_see_project()` cascade from migration 144 is in place.

---

## 3. Outdated, unused and duplicated tables

### No duplicated tables

A column-signature comparison across all 68 public tables found **zero** true duplicates. The
near-matches it surfaced (`categories_l1`/`categories_l2`, `im_asset_folders`/
`im_library_images`, `compliance_sections`) are just generic `id / name / created_at` shapes,
not redundant copies. The L1/L2/L3 split is intentional.

### Genuinely dead — 6 tables (7 including the template island)

No reference anywhere in `src/`, `netlify/` or `scripts/`; 0 rows; near-zero lifetime scans.

| table | why it is dead |
|---|---|
| `project_templates` | LaunchFlow-era scaffolding, superseded by `im_templates` |
| `template_steps` | FK only to `project_templates` — same island |
| `template_documents` | FK only to `project_templates` — same island |
| `project_comments` | 0 rows, FKs to `projects`/`profiles`, no code |
| `product_features` | 0 rows, FK to `categories_l3`, no code |
| `im_library_images` | 0 rows, no code — asset library is `im_assets` + `im_asset_folders` |
| `im_regulatory_check_units` | 0 rows, no code — superseded by `im_regulatory_checks` + `regulation_clauses` |

The three template tables form one self-contained island and can be dropped together.

### Empty but wired to live code — keep

`compliance_sections`, `im_placeholder_answers`, `im_placeholder_answer_log`,
`im_adhoc_placeholders`, `im_translation_imports`, `im_leaflet_issues`, `production_updates`,
`supplier_pm_assignments`, `rfqs`, `rfq_entries`, `supplier_proposals`, `sku_attribute_flags`,
`pm_inbox_dismissals`. These are features not yet used, not dead schema.

### Likely superseded — verify before dropping

`compliance_requirements` (36 rows, 2 code refs) and `compliance_sections`. The regulation-brain
merge (migrations 139–141) moved this domain to `regulations` / `regulation_clauses` /
`regulation_obligations`. Confirm nothing still reads them before retiring.

### Already archived correctly

`private_archive.user_profiles_145` and `private_archive.compliance_requirements_im_section_139`
— migration 145's archive-then-drop pattern. The advisor's "RLS enabled, no policy" note on
these is expected: `private_archive` is not exposed through PostgREST.

---

## 4. Bloat and cost

- **`im_publish_snapshots`: 722 rows / 116 MB across only 10 IMs, of which 604 are superseded
  versions.** Just 118 are current (project × language × template_type). There is no retention
  policy. This one table is 43% of a 267 MB database.
- **`im_tm_reuse_log`: 68,322 rows / 25 MB** accumulated since 2026-08-20 and growing fast.
  Both of its indexes (`idx_im_tm_reuse_log_locale_time`, `idx_im_tm_reuse_log_domain`, 1.5 MB)
  have **never been scanned**.
- 5 never-scanned non-unique indexes, ~1.9 MB total.
- Object storage: **794 MB** — `documents` 422 MB, `im-print` 301 MB, `im-assets` 51 MB.

## 5. Migration drift

Live history has **59** entries; `db_migrations/` has **118** files. They are not reconcilable
by name. Verified directly against the live schema:

- **147 is live** — `im_sku_leaflet_coverage` now exposes `storage_path`.
- **146 is NOT live** — `supplier_access_logs.access_code` still exists and still holds
  plaintext codes (see D4).

The standing rule from the August audit holds: **verify against `pg_policies` and the live
schema, never against `db_migrations/`.**

## 6. Other projects in the org

Only one besides this: **FairPrice AI** (`tsjrxutxqyxwbzloarfd`, eu-west-1) — status
**INACTIVE** (paused). Nothing in OriginFlow references it. No stale second database in play.

---

## Recommended order

1. **The anon-list half of S1, plus S4** — no deploy needed, no app impact. Narrow the four
   bucket SELECT policies from `public` to `authenticated` and drop the two `images` ghosts.
   Public-bucket downloads go through `/object/public/`, which does not consult
   `storage.objects` RLS, so nothing user-facing changes — but the ability to *enumerate*
   485 objects disappears. Biggest risk reduction per unit of effort in this report.
2. **D4** — apply 146, purge the 101 plaintext codes, rotate the 3 codes that are still live.
3. **S2** — decide `launchflow-docs`: delete it, or make it private and drop the anon INSERT.
   Nothing in the codebase will notice either way.
4. **The download half of S1** — deploy `im-file-url.ts`, verify a published manual + a print
   PDF + the supplier portal, *then* flip `im-published` and `im-print` to private. Order
   matters: flipping before the deploy breaks the live viewer and the whole print pipeline.
5. **S3** — convert `reviewImageUrl` to signed URLs, then flip `im-review-uploads`. Do it
   while the bucket is still empty.
6. **D1 + D2 + S5** — the portal RPC refactor. One piece of work that closes all three.
7. **§3 cleanup + §4 retention** — archive-then-drop the dead tables, add snapshot retention.

`db_migrations/150_audit_remediation.sql` contains steps 1 and 2 plus the low-risk hardening
(D6, D7, S6), ready to run. Nothing in it has been applied.
