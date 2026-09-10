# Status of this folder — read before trusting a file in it

**This folder is a change log, not a schema definition. It cannot rebuild the database.**

If you need to know what the schema *is*, introspect the live database. If you need to
know what a change was *for* and why, read the file here — the commentary in these files is
genuinely good and is the only place that reasoning exists.

Reconciled in full against project `ecueltibpmpnhnaxlskx` on 2026-09-09.

## Two files added since that reconciliation ARE pending, and their ORDER matters

Apply **170 first, then 171**. 171 refuses to run otherwise, with a message saying so.

`170_supplier_portal_design_specs.sql` — written 2026-09-10, **not applied** (re-verified
against the live project 2026-09-10: none of its four functions exist, and
`review_shares.supplier_id` is absent). It adds `review_shares.supplier_id` and four
`get_design_spec_*_by_(project_token|supplier)` reader functions, and the supplier-portal
design spec feature does not work without it. Worse, the send-for-review dialog writes
`supplier_id` on insert, so **sending a design spec for review fails outright until this is
applied**.

`171_design_spec_release_stages.sql` — written 2026-09-10, **not applied**. Replaces
`design_spec_versions.kind` (`draft`/`final`) with `stage`
(`internal`/`initial`/`final`) plus a per-stage `revision`, so a version is named
"Final Release v.02" rather than "v7 final". Also adds the forward-only stage rule, makes
issuing require a Final Release, refuses to publish an Internal Review to a supplier portal,
and **rewrites 170's two round RPCs** to return `version_stage` + `version_revision` — which
is why 170 cannot be applied after it (a `CREATE OR REPLACE` cannot change a return type, so
it would fail).

Its behaviour was exercised against the live project on 2026-09-10 inside transactions that
were rolled back — backfill, forward-only refusal, per-stage revision numbering, the issue
gate, the lock, and the portal guard all behaved as written; row counts after were unchanged
(1 spec, 3 versions, 9 shares) and no column leaked. The TypeScript half is in the same
commit, so the app is broken against a database where 171 has not run.

Apply both, then delete this section and fold the files into the table below.

## Result for everything reconciled on 2026-09-09: nothing there is unshipped

All 129 files (123 numbered `.sql`, plus 4 `.txt`, `69b`, and a seed) resolve as follows.
**Genuinely pending: zero.**

| Verdict | Count | Meaning |
| --- | --- | --- |
| **Applied** | 108 | The object the migration creates exists in the live database. |
| **Superseded** | 6 | Applied at the time, then deliberately renamed, replaced or dropped by a later migration. |
| **Not checkable this way** | 15 | Drops, revokes, policy rewrites, backfills and seeds — they remove or modify rather than create, so object existence proves nothing. |

### The 6 superseded files

Do not "re-apply" these. Each was applied and then intentionally overtaken.

| File | Signature object, now absent | Superseded by |
| --- | --- | --- |
| `36_implement_pm_rls_policies.txt` | policy `pm_admin_all_access_projects` | `81_pm_scoped_rls_v2` → `admin_all_access_projects` |
| `50_create_im_assets_bucket.sql` | policy `im-assets public read` | later hardening — bucket now has `im-assets authenticated list`, no public read |
| `67_create_im_print_bucket.sql` | policy `im-print public read` | same — now `im-print authenticated list` |
| `72_harden_assignments_rls_and_search_path.sql` | policy `auth_all_supplier_pm_assignments` | `81_pm_scoped_rls_v2` → `admin_all_access_supplier_pm_assignments` + `pm_read_own_supplier_assignments` |
| `96_category_attributes_akeneo_lookup_index.sql` | index `idx_category_attributes_akeneo_id` | `97_merge_duplicate_akeneo_attributes` → `category_attributes_akeneo_id_uniq` |
| `146_stop_storing_plaintext_access_codes.sql` | function `strip_access_code_from_log` | `150_audit_remediation` Part B |

`146` is the model to copy: its header carries a **`*** SUPERSEDED — DO NOT RUN ***`**
banner explaining what replaced it and why, and even predicts the exact error a re-run
would throw (`ERROR: 42703: column "access_code" does not exist`). Running the
reconciliation reproduced that error verbatim. Every superseded file should be labelled
like this one.

### The 15 not checkable by object existence

`38_backfill_pm_assignments.txt`, `51_add_product_images_attribute_group`,
`57_cascade_delete_project_children`, `74_lock_down_supplier_portal_phase3b`,
`75_private_documents_bucket_phase4`, `76_lock_down_user_profiles_anon`,
`78_lock_down_production_updates_phase5b`, `80_im_block_section_usage_security_invoker`,
`85_im_templates_nullable_category`, `86_drop_project_ims_single_project_unique`,
`100_seed_supplier_im_diff_review_prompt`, `103_tighten_im_print_renders_delete`,
`116_regulations_apply_by_category`, `151_revoke_trigger_fn_execute_from_public`,
`seed_regulations_hobs_marking_guide`.

These are mostly the security-hardening pass. Their effect *is* verifiable — just not by
asking "does object X exist". Check the end state instead: `pg_policies` for the lock-down
migrations, `information_schema.role_routine_grants` for the revokes, `is_nullable` /
`pg_constraint` for the ALTERs, and row presence for the seeds.

## Why it cannot rebuild the schema

| Fact | Detail |
| --- | --- |
| The lowest `.sql` is **37** | Nothing exists for 1–33. The initial schema was never captured as a file, so no replay of this folder can produce the schema. |
| **Four files are `.txt`, not `.sql`** | `34_enhance_supplier_proposals`, `35_add_pm_scoping_fields`, `36_implement_pm_rls_policies`, `38_backfill_pm_assignments` — silently skipped by any `*.sql` glob. |
| Two gaps | No 117, no 129. |
| **Two duplicate prefixes** | `38_backfill_pm_assignments.txt` / `38_fix_pm_compliance_request_insert.sql`, and `132_create_im_leaflet_issues.sql` / `132_im_review_comment_attachments.sql`. Ordering within each pair is undefined. |
| One off-scheme name | `69b_restrict_anon_document_reads.sql`. |
| One seed, not a migration | `seed_regulations_hobs_marking_guide.sql`. |

Numbered files currently span 34–160. Re-run the reconciliation (bottom of this file)
after adding any migration — `160_final_sku_mirror_lock.sql` appeared mid-session on
2026-09-09 and is applied.

## The tracking table does not map to these filenames

`supabase_migrations.schema_migrations` holds **59** rows against **123** numbered `.sql`
files, and only **8** of those rows carry a numeric prefix (58, 59, 60, 139, 140, 141,
144, 145).
The other 51 are ad-hoc names — `pm_inbox`, `im_review_stage`, `category_tree_l1_l2`,
`pt_sync_identity_and_usage`… That is the signature of changes applied through mixed
channels: some via the CLI with the filename, most via the dashboard SQL editor or the MCP
`apply_migration` tool with a hand-typed name.

**Applied-vs-pending cannot be derived from this table.** It also cannot be derived from
git — migrations 155–158 sat untracked in the working tree while already live.

## Do not infer a migration's effect from its filename

Two traps found during reconciliation, both of which produced a wrong answer before being
checked against the database:

- **`132_im_review_comment_attachments.sql` does not create a table called
  `im_review_comment_attachments`.** It adds an `attachments` JSONB column to
  `im_review_comments` and replaces `im_review_add_comment()`. The column exists, so the
  migration is **applied**. An earlier note in this repo called it the one pending
  migration purely because the table implied by its name was absent.
- **`139_regulation_brain.sql` and `145_retire_dead_auth_objects.sql`** create tables in
  the `private_archive` **schema**, not `public`. A `public`-only existence check reports
  them as missing. Both are applied (and both appear in the tracking table).

Read the file's DDL, or check the object, not the name.

## Should this folder be deleted?

**No**, but the reconciliation weakened one of the three usual arguments, so here they are
honestly:

1. **It is the only record of intent.** ✅ Stands, and is the strongest reason. The header
   comments explain *why* each change was made — reasoning that exists nowhere else,
   including in the schema. Migration 146's superseded-banner and 157's explanation of what
   `is_final` fails to answer are both irreplaceable.
2. **~~Some files are unshipped work.~~** ❌ **Withdrawn.** This was the reason given before
   the folder was reconciled. Nothing here is pending; deleting it would not lose unshipped
   features.
3. **It was never the source of truth**, so deleting it fixes nothing. ✅ Stands. The
   confusion came from the absence of an applied marker, not from the files existing — and
   that marker is now this document.

## Remaining cleanup

- [x] Reconcile all files against live introspection — done 2026-09-09, results above.
- [ ] **Add a `SUPERSEDED BY` banner to the 6 superseded files**, in the style of
      `146_stop_storing_plaintext_access_codes.sql`. This is the highest-value remaining
      task: it puts the warning where someone about to run the file will actually see it.
- [ ] **Resolve both duplicate prefixes** — 38 and 132. Renumber one file in each pair.
- [ ] **Move the four `.txt` files (34, 35, 36, 38) to an `archive/` subfolder** so they
      stop being invisible to tooling. Do not simply rename them to `.sql` — that would
      make a superseded file (36) look runnable.
- [ ] **Generate `_baseline_schema.sql`** from `supabase db dump` and treat it as the
      regenerable source of truth for what the schema *is*. See `docs/MULTI_TENANCY.md`
      step 1.
- [ ] **Pick one application channel** going forward — CLI or MCP `apply_migration` with
      the exact filename as the migration name — so the tracking table becomes meaningful
      from here. This does not fix history, but it stops the drift growing.

## Reproducing this reconciliation

```bash
node scripts/reconcile-migrations.mjs db_migrations recon.sql
# then run recon.sql against the live database (Supabase MCP execute_sql, or the SQL editor)
```

The method: parse each file for the first object it creates (table, column, function, view,
policy or index), then let the database compute existence for all of them in one query.
Cheap enough to re-run whenever the folder changes, and worth re-running after every added
migration.

The script emits SQL rather than connecting, because the repo holds an API URL and
service-role key but no Postgres password. Both parsing traps found above are fixed in it:
schema-qualified `CREATE TABLE other_schema.x`, and storage policies living in
`schemaname='storage'` rather than `'public'`.

**A `PENDING` verdict is a prompt to read the file, not a conclusion.** It means only that
the signature object is absent, which can equally mean superseded or mis-parsed — that is
exactly how all 8 initial PENDING verdicts resolved to zero.
