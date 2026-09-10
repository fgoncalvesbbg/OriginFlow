# Design Specs module — implementation plan

Status: **Phases A-D complete (2026-09-09). Phase F — release stages — written 2026-09-10,
migration 171 NOT yet applied.** Phase E not started.
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
| Versions | Unlimited; each note pins to the version it was written against; one version issued as final, which locks. **Phase F** names them Internal Review / Initial Release / Final Release, each with its own revision |
| Rounds | Several labelled links per version; round closes only when **every** live link has submitted |
| Replies | Yes — the design team can answer a note in-thread, and the supplier sees it |
| PDF access | Private bucket; Netlify function validates the token and returns a short-lived signed URL |
| Stamping | Every unreleased copy is stamped; the Final Release is served byte-for-byte. **Phase F** made the wording stage-specific — `INTERNAL REVIEW v.01 · NOT FOR DISTRIBUTION` vs `INITIAL RELEASE v.02 · FOR REVIEW ONLY` |
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

## Phase B — spec schema, storage, role — DONE

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

**Gate — passed 2026-09-09.** Applied as migration `design_specs_module`
(`db_migrations/163_design_specs.sql`).

One thing the plan had missed, found while building: **the shared review layer would have
been invisible to a DESIGNER.** `review_shares` / `review_comments` are policed by
`can_see_project`, so the role that owns design specs could not have read its own spec's
review links or supplier notes. Fixed with a *subject-scoped* escape —
`subject_type = 'design_spec' AND is_design_editor()` — rather than a blanket
`OR is_design_editor()`, which would also have exposed every project's Instruction Manual
notes to the design team.

Verified against the live database, from a real designer's seat (a PM temporarily promoted
in `user_roles`, then restored):

- a designer sees the project list, can create/read specs, and reads **0** IM review notes
- a plain PM is refused on `design_specs` INSERT (`insufficient_privilege`) and
  `is_design_editor()` is false for them — read-only, as decided
- `doc_role_from_profile('DESIGNER')` → `'designer'`; the `user_roles` CHECK accepts it
- the `design-specs` bucket is private and `application/pdf`-only

**10 of 10 cross-row guards refuse what they should**, exercised end to end: spec_code
auto-assigns (`DS-0001`), versions auto-number 1 then 2, a SKU from another project cannot
be linked (*including* when the caller lies about `project_id` to match the spec), a draft
cannot be issued as the final, a final cannot be issued without a timestamp, no version can
be added once issued, the issued final cannot be deleted while referenced, cancelling
requires a stamp, and a second spec on one project is impossible. All test rows removed;
the code sequence was reset so the first real spec is still `DS-0001`.

Three of those are **composite foreign keys rather than triggers** — a spec's final must be
one of its own versions, and a linked SKU must belong to the spec's own project. That makes
them true on every path, including a hand-written UPDATE in the SQL editor, with no trigger
to forget.

Code landed: `src/types/design-spec.types.ts`, `src/services/design/` (registry service +
round projection + barrel), `src/pages/design/design-spec-status.ts` (the derivation, +27
tests), `UserRole.DESIGNER`, and `doc-access.ts` where both role branches now go through
one `INTERNAL_ROLES` list so the next role cannot be added in one place only. The Admin
panel's two-state ADMIN/PM **toggle became a role select** — without that, DESIGNER would
have been assignable only by hand-written SQL.

Also fixed in the shared layer, benefiting the IM too: `ReviewRoundSummary` gained
`liveLinks`. A subject lands in that map for either of two reasons — a live link, or open
notes — and `submitted` could not tell them apart, so a version whose last link was revoked
while notes were still open read as "every reviewer came back".

**2057 tests pass** (up 30); both typechecks clean.

## Phase C — the PDF review surface — DONE

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
- Route: **one route per subject kind**, `/#/review/im/:token` and
  `/#/review/design-spec/:token`. This is a deliberate change from the plan's single
  `/#/review/:token` dispatcher: resolving a token is what stamps `last_used_at` and
  `use_count` ("the portal was opened"), so a dispatcher would resolve once to choose a
  portal and the portal would resolve again — double-counting every visit. The link builders
  already know the subject, so nothing needed a dispatcher.

**Gate — passed 2026-09-09.**

The shell extraction is real, not nominal: `IMReviewPortal.tsx` went from **524 lines to
about 140**, and what is left is only the viewer and the text anchor. The name gate, the note
rail, the composer, attachments, submit, the vague "invalid or revoked" screen and the new
reply threads are all shared, so the IM gained in-thread replies for free.

Landed:

- `netlify/functions/design-spec-file.ts` — signed READ URLs, 5-minute TTL. Two callers:
  a review token (served the STAMPED copy) or a session (served the original).
- `netlify/functions/design-spec-upload-url.ts` — signed WRITE URLs for both slots, gated on
  `is_design_editor()` asked *as the caller*, so it cannot drift from the table policies.
- `src/services/design/design-spec-stamp.ts` — the `DRAFT vN` banner, diagonal watermark and
  traceable footer, applied in the BROWSER before upload.
- `src/modules/review-portal/` — `ReviewPortalShell`, `PdfReviewCanvas`, `anchor-labels`.
- `src/pages/design/DesignSpecReviewPortal.tsx`, plus the review-link service.

Four things worth knowing:

1. **A reviewer can never receive the original.** A draft with no stamped copy returns 409
   rather than falling back — the fallback would hand an unmarked draft to a factory the
   moment stamping had failed. Proved by asserting which object path was signed.
2. **A review token unlocks only the version it was minted for.** Without that subject
   equality check, any live review token in the system — including one for another project's
   spec or for an Instruction Manual — would unlock any spec's PDF. This is the single most
   important test in the phase.
3. **Pins are stored as 0..1 fractions**, measured against the page wrapper and not the
   canvas bitmap: the bitmap is oversampled by the device pixel ratio, so dividing by its
   width would land every pin at a fraction of where it was clicked on a retina screen.
4. **The canvas is code-split** — the only lazily-loaded component in the app. pdf.js at
   module scope had put ~473KB into the MAIN chunk, downloaded by every user on every page
   (suppliers on portal routes included) for a viewer almost nobody opens. After splitting,
   the main chunk is **3,543KB, down from 4,032KB** — smaller than before this phase began,
   despite the phase adding a whole module.

**2110 tests pass** (up 47: the anchor labels, the stamp including the un-encodable-character
trap that would otherwise fail an upload, and 20 security tests against the real file
handler). Both typechecks clean; `vite build` succeeds.

## Phase D — internal UI — DONE

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

**Gate — passed 2026-09-09.**

Landed:

- `src/pages/design/DesignSpecsDashboard.tsx` — table + kanban toggle, remembered in
  `localStorage`, status filter chips with counts, search. **Projects with no spec are
  synthesised into Backlog**: without them the board answers "how are my specs doing" but not
  "which projects still need one", and the second question is the one that catches a launch
  with no design spec at all.
- `src/pages/design/ProjectDesignSpecPanel.tsx` — versions, upload, per-version review links
  (create / copy / open / revoke, with who is still outstanding), note triage with
  done / not-changing / reopen and replies, Issue as final, Unlock, Cancel, Reopen, SKU links.
- `src/services/design/design-spec-notes.service.ts` — the design team's side of the notes,
  thin over the shared layer.
- The **Design Spec tab on `ProjectDetail`**, and `?tab=` support so the board can link
  straight to it. The spec detail deliberately has no route of its own: one spec per project
  means the project IS its page.
- Sidebar entry, and the `/design-specs` prefix gate.

Two decisions worth recording:

1. **The board cannot be dragged.** It is a visualization of derived statuses, not an editor
   of them — a spec moves by uploading, sending or issuing, never by someone declaring it
   moved. Same reasoning as the All Manuals board.
2. **The triage UI is local, not lifted from the IM's `ReviewCommentsPanel`.** That panel
   exists to be a pointer INTO the manual editor — it jumps to a chapter and highlights a
   quote — and none of that has a counterpart on a PDF. The *services* underneath are shared,
   so triage behaviour cannot drift; consolidating the two panels is a follow-up rather than a
   pretence that they are already one.

Verified: `2113` tests pass (up 3 — the gate, including that it must NOT gate the public
review portal, where the authorization is the bearer token and a super-admin check is
meaningless). Both typechecks clean; `vite build` succeeds with the canvas still split out
(main chunk 3,579KB, canvas 484KB).

Smoke-tested in a real browser against the live database:

- `/#/review/design-spec/<bogus>` renders "This review link is invalid, expired or has been
  revoked." — exercising the route, the shared shell, and `review_resolve` as `anon`.
- `/#/design-specs` redirects an unauthenticated visitor to `/#/login`.

**NOT verified in a browser:** the authenticated screens — the board, the panel, upload,
sending a link, triage. Those need a signed-in Super Admin, which this environment has no
credentials for. They typecheck and build, but a click-through is owed before launch.

One pre-existing observation, unrelated to this module: on any public portal route an
app-level compliance-deadline check fires without a session and logs
`permission denied for table compliance_requests`. It is caught and harmless, and it predates
this work.

## Phase E — portal and notifications

- `SupplierPortal.tsx` gains a Design Spec row: **Open review** while a round is live,
  **Download final** once issued, nothing downloadable in between.
- `review_submit` and `review_add_comment` insert a `notifications` row for
  `design_specs.owner_id` (SECURITY DEFINER, per finding 6) with a link to the spec.
  Message copy: `"<supplier> submitted their review of DS-0142 v2"` /
  `"<n> new notes on DS-0142 v2"`.

### Phase E as built (2026-09-10, migration 170)

The portal half shipped; the notification half did not. What is live:

- **`review_shares.supplier_id`** — the recipient a link was minted for. The send dialog
  carries a tick, defaulted ON, that sets it to the project's supplier. This is what a portal
  lists by, and it is deliberately NOT inferred from `label`: holding a round's token makes
  the holder that reviewer (they see that recipient's earlier notes through `supersedes_id`
  and write new ones in their name), so publishing a link is a decision a person makes, never
  a guess off free text. Existing links stay null — hand-delivered, still working.
- **Four SECURITY DEFINER readers**, keyed by the two portal credentials that already exist:
  `get_design_spec_rounds_by_project_token` / `_by_supplier`, and
  `get_design_spec_finals_by_project_token` / `_by_supplier`. Rounds and finals are separate
  reads because they answer to different rules — a round is visible because it was marked for
  this supplier; an issued final is visible because the project's supplier is the party that
  builds to it, marking or no marking.
- **`design-spec-file.ts` gained a third caller**: a portal credential, which reaches the
  ISSUED FINAL ONLY. The test is the spec's own `final_version_id`, not the version's `kind`,
  so a final uploaded but not yet issued is refused too. A portal link is long-lived and
  nobody revokes it when a round closes, which is exactly why it must not reach a draft.
- **Where they render**: `SupplierPortal.tsx` puts rounds under the development phase and the
  final under production (`supplier-portal-phases.ts`, which falls back to the last phase of a
  shortened template rather than hiding the block). `SupplierDashboard.tsx` shows both inside
  each expanded project card. Both use `SupplierDesignSpecCards.tsx`, so the two surfaces
  cannot drift.
- **Not-yet-issued shows a placeholder**, rather than nothing, so the factory knows where the
  final will appear before it appears.
- **A submitted round stays open.** The portal itself says "you can still add notes", so
  greying it out in the list would contradict the page it links to. Only revoked and expired
  rounds go grey.

Still not built from Phase E: the `notifications` rows for `design_specs.owner_id`.

## Phase F — release stages (migration 171)

The workflow the design team actually runs has three named releases, and `kind`
(`draft`/`final`) could only express two:

| Stage | Who sees it | What it is for |
|---|---|---|
| **Internal Review** | us only | The pass before the supplier has ever seen the spec |
| **Initial Release** | the supplier | The first version they see; their comments land here |
| **Final Release** | the supplier | Applies those comments. The one that gets issued |

Each stage carries **its own revision counter**, so a correction to the final is
"Final Release v.02" and not a fourth stage.

### Decisions

| Decision | Choice | Why |
|---|---|---|
| Replace `kind` or add alongside it | **Replace** — `kind` is dropped | `draft` cannot say which of Internal Review and Initial Release a file is, and those two differ on the only thing that matters: whether it may reach a supplier. Keeping both vocabularies is how two screens come to describe one file differently |
| Keep the `version` counter | **Yes, unchanged** | `review_comments.subject_version` and `.checked_subject_version` pin every note and every triage verdict to it, compare orders panes by it, ghost pins match on it. It is the version's IDENTITY; `(stage, revision)` is its NAME. Renumbering would rewrite the meaning of rows already written |
| Where the revision is assigned | Server-side, in the same trigger as `version` | Two uploads must not both claim Final Release v.02. The client computes one too, but only to print the stamp before the row exists |
| Can a stage go backwards | **No** | An "Internal Review v.02" after an Initial Release claims the supplier has not seen the spec, which is false. Re-checking internally is a review *link* on the current version, not a stage |
| Can an Internal Review reach a supplier | **Never via the portal**, and that is a trigger on `review_shares`, not UI | `supplier_id` IS the publish flag, so refusing it there covers the SQL editor and the MCP too. A plain review link is still mintable — that is how a colleague marks one up — and the dialog says whoever holds a token is the reviewer |
| What the stamp says | Per stage | `INTERNAL REVIEW v.01 · NOT FOR DISTRIBUTION` vs `INITIAL RELEASE v.02 · FOR REVIEW ONLY`. A leaked internal file must not read as an invitation to review, because nobody outside was invited. A Final Release is not stamped — it IS the released document |
| Final Release v.02 while issued | Requires an explicit **Unlock** | Unchanged from Phase B, and the point: correcting a spec a factory may already be building to is a decision, not a file drop |

### What shipped

- [`171_design_spec_release_stages.sql`](../db_migrations/171_design_spec_release_stages.sql)
  — `stage` + `revision`, `unique (spec_id, stage, revision)`, the forward-only rule and
  revision assignment in `design_spec_versions_guard`, issuing gated on a Final Release,
  `review_shares_internal_stage_guard`, and 170's two round RPCs rewritten to return
  `version_stage` + `version_revision`. **It refuses to run before 170** — see
  [STATUS.md](../db_migrations/STATUS.md).
- [`design-spec-release.ts`](../src/pages/design/design-spec-release.ts) — the one
  vocabulary: stage order, labels, colours, `formatRevision` (`v.02`), `releaseLabel`,
  `allowedStagesFor` and `nextRevisionFor`. The last two are the client half of database
  rules, and are tested as such — a client that offers a control the database then refuses
  is the worst failure available here.
- Every surface renamed from the same source: the upload picker (which offers only the
  stages the spec may still use), the version rows, the viewer's switcher and compare
  headers, the note rail's "Not re-checked since Internal v.01", the board's version column,
  the stamp on the page, and the supplier's own portal cards.
- The upload number survives as a quiet `v7` beside the release name wherever a note is
  pinned to it, so it stays findable without being the headline.

Verified against the live project on 2026-09-10 in rolled-back transactions: backfill
(3 `draft` rows → Initial Release v.01–v.03), the forward-only refusal, per-stage revision
restart, the issue gate, the lock, and all four portal-guard cases.

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
| An unreleased version leaking to a factory | Only the ISSUED final is downloadable from the portal; everything else is stamped and lives behind a 5-minute signed URL. An Internal Review cannot be published to a portal at all (trigger, migration 171) |
| A stage badge read as a progress badge | They sit side by side and answer different questions — `design-spec-release.ts` is "which release is this file", `design-spec-status.ts` is "how far along is this spec". Both headers say so, and the hues carry different meanings on purpose |
