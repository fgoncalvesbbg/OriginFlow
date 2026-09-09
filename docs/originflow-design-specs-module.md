# Design Specs module — implementation plan

Status: **Phase A complete and verified live (2026-09-09).** Phases B-E not started.
Approved decisions below; the DESIGNER project-visibility open question was resolved in
favour of the surgical option (one SELECT-only policy on `projects`, `can_see_project`
left alone).

A Design Spec is a PDF the design team authors elsewhere, sends to a supplier for markup,
and then reissues as a final. This module is the registry, the review round and the
distribution — it is **not** an authoring tool. There is no in-app PDF editing, deliberately.

## The decisions this is built on

| Decision | Choice |
|---|---|
| Review layer | Rename `im_shares` / `im_review_comments` to neutral `review_shares` / `review_comments`, keyed by subject |
| Anchoring | One shared portal; anchor is a union — chapter+quote for IM, page + normalised coords for PDF |
| Statuses | `Backlog` and `Cancelled` stored; `In Progress` / `In Review` / `Final` derived |
| Cardinality | One spec per project |
| Versions | Unlimited; each note pins to the version it was written against; one version issued as final, which locks |
| Rounds | Several labelled links per version; round closes only when **every** live link has submitted |
| Replies | Yes — the design team can answer a note in-thread, and the supplier sees it |
| PDF access | Private bucket; Netlify function validates the token and returns a short-lived signed URL |
| Stamping | `DRAFT vN · FOR REVIEW ONLY` on drafts; the issued final is served byte-for-byte |
| Role | New `DESIGNER`; DESIGNER and ADMIN both have full rights, PM read-only |
| Notifications | Project Inbox entries on supplier submit and on each new note |
| Cancelled | Manual action; revokes every live review link; files and history retained |
| Views | Kanban board + table toggle, same as All Manuals |
| Fields | Spec code, title, owner, linked SKUs. **No target date** (declined) |

## Live-state findings that changed this plan

All verified against project `ecueltibpmpnhnaxlskx` on 2026-09-09, not read from `db_migrations/`.

1. **Migration 159 IS applied.** `user_roles`, `doc_documents`, `doc_versions` and the private
   `sop-documents` bucket are all live. `db_migrations/STATUS.md`, `CLAUDE.md` and Claude's own
   memory all recorded 159 as *not* applied — exactly the drift `CLAUDE.md` warns about. This
   plan therefore *extends* `user_roles` rather than creating it.

2. **`DESIGNER` would be read as a supplier by the doc module.**
   `netlify/functions/lib/doc-access.ts:358` does
   `if (role !== 'admin' && role !== 'internal') { … kind: 'supplier' }`, and `:252` the same.
   A `user_roles.role = 'designer'` row therefore hands that account the *supplier-audience*
   view of SOP documents. `user_roles_role_check` is also live as
   `role IN ('admin','internal','supplier')`, so `'designer'` fails the CHECK outright.
   Fix in Phase B: widen the CHECK, extend `doc_role_from_profile`, and teach those two
   `doc-access.ts` branches that `designer` is internal.

3. **A `DESIGNER` can currently see zero projects.**
   `can_see_project(uuid)` is live as *ADMIN, or `projects.pm_id = auth.uid()`* — a designer is
   neither. `projects` SELECT is likewise ADMIN-or-own-PM. 16 policies across 7 tables call
   `can_see_project`, and they are `FOR ALL`, so widening that function would hand designers
   write access to seven tables of project data as a side effect. Phase B takes the surgical
   route instead — see the open decision below.

4. **The live RLS on the review tables is not what the repo says.** Migrations 84 and 131
   describe an `"Auth all"` policy; live, both `im_shares` and `im_review_comments` carry
   `"Scoped all"` = `can_see_project(project_id)`. The rename must preserve the live policy.
   (Policies follow a table through `ALTER TABLE … RENAME`, so this is a thing to *not break*,
   not a thing to rewrite.)

5. **The rename is cheap.** `im_shares` 6 rows, `im_review_comments` 5 rows, and only one
   `template_type` value (`im`) in use in either. 6 RPCs to reshape.

6. **`notifications` INSERT is own-row-only** (`user_id = auth.uid()`), so a notification aimed
   at the owning designer must be written by a `SECURITY DEFINER` RPC, not by the client.

7. `profiles.role` has **no** CHECK constraint, and live values are `ADMIN` and `pm` — lowercase.
   Adding `DESIGNER` costs no DDL, but every comparison must stay `upper()`-wrapped.

## One open decision

**How does a DESIGNER reach project context?** They need project names on the board and the
project behind a spec, but they are neither ADMIN nor the project's PM.

- **Recommended — surgical.** Leave `can_see_project` untouched. Add one `SELECT`-only policy on
  `projects` for design editors, and scope `design_specs` reads with
  `can_see_project(project_id) OR is_design_editor()`. A designer gets read-only project
  visibility and full rights on specs, and the other 6 tables are unaffected.
- Widen `can_see_project` — one function, but it silently grants designers `FOR ALL` on 7 tables.
- Give designers no project access; the board shows spec codes only. Cheapest, close to useless.

Phases B–E below assume the recommended option. Say so if you want a different one.

## Phase A — generalize the review layer (no behaviour change) — DONE

`db_migrations/162_review_layer_generalize.sql`

```sql
alter table public.im_shares rename to review_shares;
alter table public.review_shares rename column template_type  to subject_type;
alter table public.review_shares rename column manual_version to subject_version;
alter table public.review_shares add column subject_id uuid;   -- null for IM, version id for specs

alter table public.im_review_comments rename to review_comments;
alter table public.review_comments rename column template_type  to subject_type;
alter table public.review_comments rename column manual_version to subject_version;
alter table public.review_comments add column subject_id uuid;

-- PDF anchor. w/h are nullable so a rectangle selection can arrive later without a migration.
alter table public.review_comments
  add column page     integer,
  add column anchor_x numeric(6,5), add column anchor_y numeric(6,5),
  add column anchor_w numeric(6,5), add column anchor_h numeric(6,5);
alter table public.review_comments alter column section_id drop not null;

-- exactly one anchor shape per note
alter table public.review_comments add constraint review_comments_one_anchor check (
  (section_id is not null and page is null)
  or (section_id is null and page is not null and anchor_x is not null and anchor_y is not null)
);
```

- `subject_type` becomes `'im' | 'warning_leaflet' | 'design_spec'`. Neither column carries a
  CHECK today and none is added — the values are constrained in TypeScript, matching house style
  in these tables.
- **Replies** get their own table rather than a self-FK, so the anchor CHECK above stays honest
  and a reply cannot be triaged as if it were a note:
  `review_replies (id, comment_id → review_comments on delete cascade, body, author_name,
  author_user_id uuid null, created_at)`. Supplier replies arrive by RPC (name only); internal
  replies are authenticated (`author_user_id`).
- **Backward-compatible views** `im_shares` and `im_review_comments` reproject the old column
  names, created `with (security_invoker = true)` so base-table RLS still applies — without that
  flag a view owned by the migration role would bypass it. Single-table views with renamed
  columns stay auto-updatable, so a missed write path keeps working too.
- **RPCs**: create `review_resolve`, `review_add_comment` (extra `p_page/p_x/p_y/p_w/p_h` args),
  `review_list_comments`, `review_delete_comment`, `review_submit`, `review_add_reply`. The six
  existing `im_review_*` functions are then `CREATE OR REPLACE`d as thin delegating wrappers —
  **never dropped**, per migration 130's note that dropping a live function takes the public page
  down mid-deploy. Wrappers get deleted in a later migration once the IM surfaces are confirmed.

Code: move `src/services/im/im-share.service.ts` and `im-review-comments.service.ts` to
`src/services/review/`, parameterized by subject; generalize `src/pages/im/review-anchor.ts` into
a text-anchor + pdf-anchor pair; leave re-export shims at the old paths so the IM pages compile
throughout, then migrate the IM call sites in the same phase and delete the shims.

**Gate — passed 2026-09-09.** Applied as migration `review_layer_generalize`. Verified:

- `security_invoker=true` present on both compat views; `anon` reads **0** rows through the
  views and through both base tables (without that flag the views would have handed every
  token and note to `anon`, which holds a blanket table grant).
- Row counts unchanged: `review_shares` 6, `review_comments` 5.
- Old entry points still answer with their original output column names —
  `get_im_share_by_token`, `im_review_resolve`, `im_review_list_comments`.
- The whole round exercised **as the `anon` role** against a live review link: add note,
  list, reply, anchor guard (a doubly-anchored note is refused with a reviewer-readable
  message), submit, submit-again-is-idempotent, retract. All state restored afterwards —
  the `submitted_at` stamp and the two `use_count`/`last_used_at` counters touched by
  testing were reset to their pre-test values.
- All three anchor constraints reject bad rows (unanchored, doubly-anchored, coordinate
  outside 0..1).
- `tsc` clean for the app and the functions; **2027 tests pass**, up 13 — new coverage for
  the subject seam (`createIMShare` writes `review_shares` with `subject_type`/`subject_id`/
  `subject_version`) and for the anchor union, including the numeric-string coercion that
  PostgREST forces on `numeric` columns and that would otherwise position every pin at NaN.

Code landed: `src/types/review.types.ts`, `src/services/review/` (share + comments +
barrel + tests). `src/services/im/im-share.service.ts` and `im-review-comments.service.ts`
are now thin IM adapters over it, keeping every existing export name and signature — so no
IM page, panel or dashboard changed, and there is one implementation of the review rules.
`pm-inbox.service.ts` and the two Netlify functions point at the renamed tables; the inbox
lane is filtered to IM subjects so a design-spec note cannot appear there with an
`/im-generator/` link.

**Still owed (follow-up migration, once the new bundle is deployed and confirmed):** drop
the `im_shares` / `im_review_comments` compat views and the six `im_review_*` wrapper
functions. Nothing in the repo calls them any more — they exist only for a browser still
running the pre-162 bundle.

## Phase B — spec schema, storage, role

`db_migrations/163_design_specs.sql`

```sql
create table public.design_specs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references public.projects(id) on delete cascade, -- one per project
  spec_code text not null unique,          -- DS-0001, from a sequence
  title text not null,
  owner_id uuid references auth.users(id),
  state text not null default 'backlog' check (state in ('backlog','active','cancelled')),
  final_version_id uuid,                   -- set on issue; this is the lock
  issued_at timestamptz, issued_by text,
  cancelled_at timestamptz, cancelled_by text,
  created_at timestamptz not null default now(), created_by text, updated_at timestamptz
);

create table public.design_spec_versions (
  id uuid primary key default gen_random_uuid(),
  spec_id uuid not null references public.design_specs(id) on delete cascade,
  version integer not null,
  kind text not null check (kind in ('draft','final')),
  storage_path text not null,   -- original bytes, never mutated
  stamped_path text,            -- DRAFT-stamped copy served to reviewers
  page_count integer, byte_size integer,
  uploaded_at timestamptz not null default now(), uploaded_by text,
  unique (spec_id, version)
);

create table public.design_spec_skus (
  spec_id uuid references public.design_specs(id) on delete cascade,
  sku_id  uuid,  -- FK confirmed against the live SKU table before this is written
  primary key (spec_id, sku_id)
);
```

`state` stores **only** the two ends. `In Progress` / `In Review` / `Final` are never stored —
they derive in `design-spec-status.ts`, modelled directly on `im-manual-status.ts`:

```
backlog      state='backlog'                             (stored)
cancelled    state='cancelled'                           (stored, overrides everything)
final        final_version_id is not null                (issued + locked)
in_review    a live, unsubmitted review_shares row for the current version
             · sky   = still out    · green = every live link submitted
in_progress  everything else — a version exists, no live round
```

Storage: private bucket `design-specs`, `application/pdf` only, 50 MB, **no storage policies** —
service_role only, the same shape as `sop-documents`.

Role plumbing:

- `alter … user_roles_role_check` → `('admin','internal','supplier','designer')`
- `doc_role_from_profile` gains `when 'DESIGNER' then 'designer'`
- `netlify/functions/lib/doc-access.ts:252,358` — treat `designer` as internal (finding 2)
- `UserRole` enum in `src/types/common.types.ts` gains `DESIGNER`; Admin Panel can assign it
- new `public.is_design_editor()` — `stable security definer`, true when `user_roles.role` is
  `admin` or `designer`
- one new `SELECT`-only policy on `projects` for design editors (the open decision above)
- `design_specs*` policies: SELECT `can_see_project(project_id) or is_design_editor()`;
  INSERT/UPDATE/DELETE `is_design_editor()`

## Phase C — the PDF review surface

- `netlify/functions/design-spec-file.ts` — takes a review token *or* an authenticated session,
  validates it server-side, returns a 5-minute signed URL. Revoking a link genuinely revokes
  the PDF. Reviewers are served `stamped_path`; internal users get `storage_path`.
- `netlify/functions/design-spec-stamp.ts` — on draft upload, `pdf-lib` writes the
  `DRAFT vN · FOR REVIEW ONLY` header and the `DS-code · project · date` footer, stores the
  result as `stamped_path`. Finals skip this entirely.
- `src/modules/review-portal/` — the shared shell extracted from `IMReviewPortal.tsx`: reviewer
  name, note list, image attachments, submit, invalid/revoked screen, reply threads. Takes the
  document surface as a slot.
- `src/modules/review-portal/PdfReviewCanvas.tsx` — renders pages with `pdfjs-dist` (already a
  dependency, already used in `src/modules/pdf-to-markdown/`), drops numbered pins, stores
  normalised 0–1 coords so a pin survives zoom and page size.
- Route: `/#/review/:token` resolves the subject and picks the surface. `/#/review/im/:token`
  is kept as a redirect — links of that shape are already out with suppliers.

## Phase D — internal UI

- `src/pages/design/DesignSpecsDashboard.tsx` — board/table toggle lifted from
  `IMDashboard.tsx` (which already persists the choice in `localStorage`), columns in the
  five-status order, `is_design_editor` gating every mutation.
- `src/pages/design/DesignSpecDetail.tsx` — version list, upload, mint/revoke links per version,
  round outcome per link ("1 of 3 outstanding"), note triage with `open`/`done`/`wont_fix` and
  replies, Issue Final (locks), Cancel (revokes every live link).
- A Design Spec tab/card on `ProjectDetail.tsx`.
- `/design-specs` added to `SUPER_ADMIN_ONLY_PATH_PREFIXES` for the build, removed at launch.
  (You chose a DESIGNER role rather than the super-admin gate as the access model; the gate is
  still worth having while the module is half-built, and it costs one line to remove.)

## Phase E — portal and notifications

- `SupplierPortal.tsx` gains a Design Spec row: **Open review** while a round is live,
  **Download final** once issued, nothing downloadable in between.
- `review_submit` and `review_add_comment` insert a `notifications` row for
  `design_specs.owner_id` (SECURITY DEFINER, per finding 6) with a link to the spec.
  Message copy: `"<supplier> submitted their review of DS-0142 v2"` /
  `"<n> new notes on DS-0142 v2"`.

## Deliberately not built

- In-app PDF editing or redlining. The design team authors elsewhere.
- Email. `triggerEmailNotification` is a stub that suppresses every send; links are copied by
  hand and the Project Inbox is the only working channel. This plan adds no email.
- Target dates and overdue flags (declined). Backlog orders by creation date only.
- Approve/reject decisions. A round closes on submit; the notes are the outcome.
- Automatic carry-forward of open notes to a new version (declined in favour of pinning).

## Risks

| Risk | Mitigation |
|---|---|
| The rename breaks the live IM round | Compat views + old RPCs kept as wrappers; Phase A gated on an end-to-end IM round passing before anything else starts |
| `DESIGNER` mis-read as a supplier by the doc module | Finding 2 — CHECK, mapper and both `doc-access.ts` branches fixed together in Phase B, with a test |
| Stamping corrupts a designer's artwork | Stamp writes to a *separate* object; `storage_path` is never mutated, so the original is always recoverable |
| A draft leaking to a factory | Drafts are never downloadable from the portal, are stamped, and live behind a 5-minute signed URL |
