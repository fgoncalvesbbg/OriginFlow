# Multi-tenancy: one company per Supabase project

Status: **decided, not yet implemented** (2026-09-08). No tenancy exists in the codebase
today — `org_id` / `tenant_id` / `company_id` appear nowhere in `src/` or `db_migrations/`.

## The decision

Run **one Supabase project per company** (physical isolation), with **one codebase**
deployed once per company. Resolve the tenant from the **subdomain**.

```
klarstein.originflow.app  ──▶  Netlify site A  ──▶  Supabase project A
acme.originflow.app       ──▶  Netlify site B  ──▶  Supabase project B
                    (same git commit on both)
```

### Why not a single database with `org_id` (pooled)

This is the normal SaaS answer and it is cheaper to run, but it was rejected here because
the requirement is a hard "companies cannot see or interfere with each other", and the
isolation would rest entirely on RLS being perfect. Current state argues against that:

- 25 of 131 RLS policies key off `role = 'ADMIN'` with no tenant scope.
- 5 of 7 storage buckets are public and anon can list them.
- Known RLS cascade gaps (see `SUPABASE_AUDIT_2026-09-07.md`).

Retrofitting would mean `org_id` on 76 tables plus a rewrite of all 131 policies. Silo
isolation is a property of the infrastructure instead, so a policy bug cannot cross
companies.

### Why not duplicated tables in one database

Rejected outright. Per company it needs a parallel copy of 76 tables, 131 policies,
61 functions and 12 triggers, every migration replayed with renames, and a dynamic table
prefix threaded through the whole data layer — which currently hardcodes names
(`from('projects')`). Worst of all the isolation boundary becomes a *naming convention*:
one database, one anon key, one JWT issuer. Strictly more work than `org_id` for strictly
less safety.

### Why not a code fork per company

Tempting, because a fork obviously allows per-company customization. Rejected:

- Once fork B applies migrations differently the schemas diverge, and then the code
  genuinely *cannot* be shared even if you want it back. There is no merge path.
- Every fix multiplies. One developer cannot maintain N drifted forks.
- Separate database does **not** require separate codebase. Same commit, different env vars.

The asymmetry decides it: unified to forked is a `git clone` away at any time. Forked back
to unified means reconciling N schemas and N codebases by hand. Keep the reversible door.

## How per-company customization works without forking

Three tiers, in the order to reach for them:

**1. Different rows.** Most "customization" is content and config, and it is already data:
`im_print_settings` (19 columns), `im_templates`, `template_steps`, `template_documents`,
`project_templates`, the category tree, the regulation library. Each company's database
simply *contains* different rows. Zero code divergence — this is the main dividend of the
silo model and it is free.

**2. Module composition.** `src/config/moduleAccess.config.ts` already gates path prefixes
and is read by both the route table (`SuperAdminRoute` in `App.tsx`) and the sidebar
(`Layout.tsx`), so a module cannot be hidden from nav while staying URL-reachable. Change
the predicate from "is super admin" to "is enabled for this tenant" and you get
per-company module composition. Note its own caveat: it is a *visibility* gate, not a
security boundary — anything that must hide data still needs RLS.

**3. Genuinely different logic.** The small residue. Use a tenant flag branching in shared
code, or an explicit strategy seam. Fork one company only when the demand is both
irreconcilable and lucrative enough to fund a parallel maintenance line.

## Code changes required

The ports/adapters boundary contains most of this: `src/data/supabase/client.ts` is the
only place credentials enter, and nothing outside `src/data/` may import it.

1. **Build-time env vars.** `import.meta.env.VITE_SUPABASE_URL` is inlined by Vite, so one
   bundle cannot hold N URLs. Either one Netlify site per company (simplest, and the
   subdomain comes free) or resolve host to `{url, anonKey}` at runtime from a small config
   endpoint. Anon keys are public by design, so shipping all of them is not a leak.
2. **Lazy client construction.** Both `supabaseClient` and `supabasePortalClient` are
   built at module import time. They must defer until the tenant is known.
3. **Per-tenant service-role keys.** The 15 Netlify functions share one `SUPABASE_URL` +
   `SUPABASE_SERVICE_ROLE_KEY`. Per-tenant keys must be selected server-side from the
   *verified* host or JWT issuer — **never** from a request parameter, or clients get a
   tenant-switching primitive against a service-role key.
4. **`storageKey` collision.** `client.ts` hardcodes `storageKey: 'sb-auth-token'`, so two
   tenants on one origin would collide in localStorage. Separate subdomains fix this for
   free; a single-origin runtime-resolution design must make the key tenant-specific.
5. **Super Admin becomes per-project.** The `is_super_admin` flag (migration 154) is scoped
   to one database. A global admin across companies needs a separate control plane, and
   cross-company reporting becomes N queries.

### Why subdomain and not email domain

Email-domain routing was considered and rejected:

- **Chicken-and-egg** — you must know which auth server to talk to *before* you can
  authenticate, so it needs an extra hop just to resolve the domain.
- **Contractors** on gmail/outlook have no matching domain.
- **The supplier portal has no login at all.** `supabasePortalClient` runs unauthenticated
  for external suppliers, so there is no email to read. The tenant must come from the URL.

## Runbook: cloning a Supabase project for a new tenant

### Prerequisites

None of `supabase`, `psql`, `pg_dump` or `docker` are installed on this machine.

```bash
npm i -g supabase && supabase --version
```

If `db dump` demands Docker, install Postgres client tools (`scoop install postgresql`)
and use `pg_dump` directly. Connection string: Dashboard, Settings, Database.

### Baseline to replicate (source project `ecueltibpmpnhnaxlskx`, measured 2026-09-08)

| Object | Count |
| --- | --- |
| public tables | 76 |
| public views | 2 |
| RLS policies (public) | 131 |
| RLS policies (**storage**) | 22 |
| functions | 61 |
| triggers | 12 |
| storage buckets | 7 (5 of them public) |
| non-default extensions | `pg_net`, `uuid-ossp`, `pgcrypto`, `pg_trgm` |
| enum types / matviews | 0 / 0 |

Verify these in the new project before pointing a frontend at it.

### Step 1 — dump from the source project

**Do not replay `db_migrations/`** — it cannot rebuild the schema. See
`db_migrations/STATUS.md`. Dump the live database instead. Three dumps, because one
command does not cover it:

```bash
PROD="postgresql://postgres:[PW]@db.ecueltibpmpnhnaxlskx.supabase.co:5432/postgres"

supabase db dump --db-url "$PROD" -f schema.sql                     # public: tables, functions, triggers, policies
supabase db dump --db-url "$PROD" --schema storage -f storage.sql   # the 22 storage policies
supabase db dump --db-url "$PROD" --data-only --schema public -f data.sql
```

Do **not** dump the `auth` schema — Supabase manages it, and a new tenant should start
with zero users anyway.

### Step 2 — create the project

Cost is currently **$0/month** on org `tkwvdfjwtdcftkjqmgrk`. But free-tier projects
auto-pause after inactivity (`FairPrice AI` is already `INACTIVE`), and a paused tenant
database means that company's app is **down**. Put any real customer tenant on a paid plan.

### Step 3 — restore the schema

1. Enable the four non-default extensions first (`pg_net` especially — triggers use it).
2. Apply `schema.sql`.
3. Create the 7 storage buckets — **private**, see below — before applying `storage.sql`,
   since the policies reference bucket ids.
4. Apply `storage.sql`.

> While you are here: 5 of 7 buckets in the source project are public and anon-listable.
> Create the new tenant's buckets private from the start rather than replicating the hole.

### Step 4 — seed selectively

Do **not** restore `data.sql` wholesale. Split it.

**Copy — reference and config data:**
`categories_l2` (53), `categories_l3` (135), `category_attributes` (99), `regulations` (20),
`regulation_clauses` (60), `regulation_obligations` (66), `compliance_requirements` (36),
`im_templates` (45), `im_print_settings`, `project_templates`, `template_steps`,
`template_documents`.

**Leave empty — tenant data:**
`projects`, `project_skus`, `project_ims`, `im_sections`, `im_blocks`,
`im_publish_snapshots`, `supplier_access_logs`, `notifications`, `sku_change_log`,
`project_documents`, `document_versions`.

> **Never copy `im_tm_segments` (38,979 rows) or `im_tm_reuse_log` (64,221 rows).**
> That is Klarstein's own translation memory. Copying it hands another company your
> translated content as their TM suggestions. This is the most important exclusion here.

### Step 5 — edge functions

Three edge functions run in the source project, but a new tenant needs **only one**:

| Slug | Name | Carry forward? |
| --- | --- | --- |
| `regulatory-check` | `regulatory-check` | **yes** — live and in use |
| `send-tcf-notification` | `send-tcf-notification` | no — dead |
| `smooth-responder` | `send-submission-email` | no — dead and superseded |

```bash
supabase functions deploy regulatory-check --project-ref <new-ref>
```

Secrets do not transfer between projects — re-set them with `supabase secrets set`.

Both email functions are unreachable: `triggerEmailNotification` in
`src/services/shared/notification.service.ts` is a stub that suppresses every send. All
three sources now live in `supabase/functions/` — the two email ones were recovered from
the deployed artifacts on 2026-09-08, having had no source in the repo. See
`supabase/functions/README.md`.

### Step 6 — what no dump carries

Configure by hand in the new project: auth site URL and redirect URLs, SMTP and email
templates, auth providers, JWT expiry, and all secrets.

Then set per-tenant Netlify env vars: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`SUPABASE_ANON_KEY`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.

### Step 7 — verify

Re-measure against the baseline table above, then point the frontend at it.

## Open follow-ups

- [x] Pull the two orphaned edge function sources into `supabase/functions/` — done
      2026-09-08.
- [ ] **Delete the two dead email functions from production** and drop their secrets
      (`RESEND_API_KEY`, `FROM_EMAIL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`). Nothing
      calls them; they are archived in the repo, so deletion loses nothing. Needs a
      decision.
- [ ] Script steps 1–7 as `scripts/clone-tenant.mjs` so tenant #3 is one command.
- [ ] Decide the per-tenant config shape: what moves into a `tenant_settings` table
      versus what stays in `moduleAccess.config.ts`.
- [ ] Make buckets private and close the anon-list hole (applies to the existing project
      too, not just new tenants).
