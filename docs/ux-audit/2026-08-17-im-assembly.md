# OriginFlow audit — IM assembly — 2026-08-17

**Scope chosen:** J4 — Assemble & publish an IM for a market set (Assembler · per-launch · regulatory). Named by the requester ("IM assembly").
**Traced:** `/project/:projectId/im-generator/:templateType?` (`src/app/App.tsx:144-148`, `ProtectedRoute` only) → `src/pages/im/ProjectIMGenerator.tsx` (fill / add-content / preview) → `saveProjectIM` (`src/services/im/project-im.service.ts:53-126`) → publish (`src/services/im/im-publish.service.ts:197-293`, one JSON per language + manifest to public `im-published` bucket) → print export (`src/pages/im/project-im-generator/PrintExportDialog.tsx` → `src/services/im/im-print-export.service.ts:229-293` → 4 Netlify functions → public `im-print` bucket + `im_print_renders` row) → attach to project docs (`ProjectIMGenerator.tsx:864-892`) → share links (`src/services/im/im-share.service.ts`) → staleness/republish (`src/services/im/im-staleness.service.ts`).
**Delta vs last report on this scope:** no prior report (first run; `docs/ux-audit/` created by this audit).

> **Fix status (same day, 2026-08-17):** A1 fixed (generator mirrors resolver; no-data conditions excluded + surfaced in the pre-publish checklist). A2 fixed (republish bumps the version; manifest now carries the version; FINAL manuals refused). A7 fixed (prepare hard-fails on unpublished languages and unresolved `{{tokens}}`; stamp encoder keeps all WinAnsi glyphs; Inter font import added; all 22 language names added). A6 resolved by **removing** the XML export (confirmed unused). B1 S-mitigation shipped (publish-history panel on the project IM tab, fed by `im_publish_snapshots`). B3 fixed in code (`finalized_by` recorded; delete/republish guards).
>
> **Second pass (same day):** A3 fixed (per-language publish failure reporting; snapshot insert retried once then surfaced as a warning). A4 fixed (`unknown` manual status + dashboard retry banner + ProjectDetail "check failed" chips; `getProjectIM` now propagates errors). A5 fixed (load failure renders an error-with-retry screen, never the template picker). B2 fixed (share-links list + revoke in the viewer tab). B4 fixed (optimistic concurrency on `saveProjectIM` with `updated_by` attribution + conflict banner; edits preserved via the local draft). C1 fixed (stable block-ref ids backfilled on template save; overrides keyed `ref:<id>` with legacy positional fallback + lazy per-manual key migration). New feature: daily rolling backups (last 3 days, one snapshot/day, restore-into-editor from the generator's settings menu).
>
> **DB migrations 102–105 are written but NOT yet applied to the live DB** (permission-blocked; apply manually, in order, BEFORE deploying this code — 104's `updated_by` and 102's `finalized_by` are written unconditionally by the save/finalize paths).
>
> **Hardening pass (2026-08-18):** Print pipeline — merge is idempotent per job (jobId-keyed path; a timeout-retry of a completed merge returns the existing PDF instead of double-charging), sibling part-workers stop when the job is doomed, permanent failures return 422 (no useless retries), and a failed history-row insert is retried then surfaced as a warning instead of a silent 200. Staleness is per-language ("Out of date in: DE, FR" — `StaleManual.staleLanguages`). Publish button states the language count; the template picker prefers the project's category and marks draft templates. Share links gained label/expiry/`revoked_by` (RPC enforces expiry — migration 106). XLIFF export hard-fails when verbatims can't load; import shows an overwrite-count preview and persists its run-report to `im_translation_imports` (migration 108). **Markets shipped** (migration 107): admin-configured market → language mapping (Admin panel → Markets), offered as one-click presets in the print dialog and stamped onto `im_print_renders.market` + shown in both render timelines. **Migrations 106–108 join 102–105 as pending live-DB apply.**
>
> **Inline-editor pass (2026-08-18, `InlineBlockEditor.tsx`):** fixed callout bodies losing every paragraph after the first on round-trip; nested lists now round-trip (depth model + Tab/Shift+Tab indent); HTML-table pastes (Excel/Sheets) become real table blocks instead of flattening mid-paragraph; H1/H2/H3/Paragraph convert the caret's block instead of appending; placeholder/condition chips are click-to-edit (label edits fan out across languages; two latent chip bugs fixed — `data-always` and `data-condition-value` were dropped on round-trip); machine translations carry an EN-source hash (`im-translation-marker.ts`) so language tabs show an amber stale dot when English changes; tables insert at the caret and gained a delete-table button; selected images gained an editable Alt field. No DB changes.

DB-enforcement claims below were verified against the **live** Supabase project (`pg_trigger` / `pg_policies`), not just repo migrations.

---

## 1. Verdict in three lines

Publishing one manual for N locales is one combined-booklet pipeline, and its editing surface is genuinely good — crash-safe local drafts, 4s autosave, undo/redo, a pre-publish checklist, an "already up to date" guard, content-hash staleness detection, and a print history with mandatory change notes; none of that should be touched. The defects cluster after the Publish click: the preview and the published output disagree on no-data conditional chapters, a republish changes live content without bumping the version (so the print dialog then tells the operator *not* to reprint), several failure paths render as success, and there is no record anywhere of which market/locale has which revision — that bookkeeping lives entirely in the assembler's head or Excel. Fix first: the preview/publish divergence (A1) — it silently drops chapters from a legal document while the screen says "In the manual".

---

## 2. Ladder A — defects visible in code

### A1. Preview shows a chapter as "In the manual"; publish silently drops it
- **Role / job / frequency:** Assembler · J4 · per-launch (every manual with attribute-conditional chapters)
- **Evidence:** The generator's visibility check includes a conditional chapter when its attribute has **no submitted value**: `if (!value) return true; // no submitted data → include by default` (`src/pages/im/ProjectIMGenerator.tsx:1810-1812`), and the Chapter Conditions panel says so in words: "no value entered yet, kept in by default" (`ProjectIMGenerator.tsx:3863-3865`). The resolver that produces the published JSON does the opposite: `if (actual === undefined) return false;` (`src/services/im/im-resolver.ts:208-209`). Both read the same merged data (`buildPlaceholderData`, `ProjectIMGenerator.tsx:496-507`), so any conditional chapter whose attribute was never filled is rendered in the WYSIWYG preview and the panel as included, then omitted from every published language and every print PDF.
- **Consequence:** The assembler signs off on a preview containing a chapter (potentially a safety chapter) that the published manual does not contain. Nothing in the pre-publish checklist (`ProjectIMGenerator.tsx:2557-2623`) flags unresolved conditions.
- **Blast radius:** every language of the manual, every SKU bound to it, plus the printed booklet — for each affected chapter.
- **Smallest viable change (S):** make the two defaults identical (pick one; the resolver's exclude-by-default is the safer compliance posture) and add a checklist line "N chapters have conditions with no data — currently excluded/included".

### A2. Republish changes published content under the same version — then the print guard says "nothing changed"
- **Role / job / frequency:** Assembler / process owner · J4 · whenever a template or shared block is corrected after publish (the staleness workflow exists precisely for this)
- **Evidence:** `republishProjectIM` re-resolves and overwrites the published JSON but, by documented design, "does not regenerate the PDF or bump the version" (`src/services/im/im-staleness.service.ts:194-210`). The print dialog's duplicate guard compares only version numbers: `version > match.imVersion ? 'outdated' : 'current'` (`src/pages/im/project-im-generator/PrintExportDialog.tsx:135-148`), and `'current'` shows "generating the same version again wastes a credit" and demands an extra confirmation. Bulk republish on the dashboard drives the same path (`src/pages/im/IMDashboard.tsx:120-143`).
- **Consequence:** after a safety-block correction is republished, the digital manual is fixed but the version number didn't move — so the print dialog actively discourages re-rendering the now-outdated print PDF, and nothing anywhere flags that the last printed booklet no longer matches the published JSON. The manifest doesn't carry the version at all (`src/services/im/im-publish.service.ts:281-288`), so downstream consumers can't detect the change either.
- **Blast radius:** every printed/attached PDF of every republished manual; the version number stops identifying content.
- **Smallest viable change (S/M):** compare content hashes, not versions, in the duplicate guard (`im_print_renders` could store the manifest's per-language hashes at render time), or bump the version on republish. Either restores "the guard tells the truth".

### A3. Publish is non-atomic and reports partial failure as a single generic error
- **Role / job / frequency:** Assembler · J4 · every publish of a multi-language manual
- **Evidence:** `publishResolvedManuals` uploads language JSONs sequentially and writes the manifest only after all succeed (`src/services/im/im-publish.service.ts:254-289`). A failure at language *k* leaves languages 1…k−1 live at their deterministic public URLs with the **old** manifest still pointing at old content; the operator sees one `alert("Failed to publish…")` (`ProjectIMGenerator.tsx:851-858`) with no statement of which languages made it. The per-language snapshot insert — the basis of staleness detection — is swallowed on failure (`im-publish.service.ts:260-274`), after which the manual reports stale forever with no explanation.
- **Consequence:** a mixed-state public bucket the operator cannot see or reason about; retry-from-scratch is the only option, and a swallowed snapshot silently corrupts the "Needs re-publish" signal.
- **Blast radius:** all languages of one manual; staleness accuracy for that manual indefinitely.
- **Smallest viable change (S):** report per-language success/failure in the error path (the loop already knows), and surface snapshot-insert failure instead of `console.error`.

### A4. Failed checks render as success across the status surfaces
- **Role / job / frequency:** Assembler / team lead / director · J4, J10, J11 · every dashboard load
- **Evidence:** every staleness caller swallows rejections — `getStaleProjectIMDetails().catch(() => {})` (`src/pages/im/IMDashboard.tsx:69-76`; same pattern in `ProjectDetail.tsx`) — and the status model has no "unknown" state (`src/pages/im/im-manual-status.ts:22,30-34`), so a failed check renders every manual as green "Published — up to date with their sources". Likewise `getProjectIM` returns `null` on query failure (`src/services/im/project-im.service.ts:44-47`), and the dashboard list queries use `orEmpty` (`project-im.service.ts:193-200`), so "query failed" is indistinguishable from "nothing exists".
- **Consequence:** the screens whose whole job is "is anything out of date?" answer "no" when they actually mean "I couldn't check" (H13). For a compliance dashboard this is the worst possible failure default.
- **Blast radius:** the entire manual library view, silently, for as long as the underlying error persists.
- **Smallest viable change (S):** add an `unknown` status / "staleness check failed — retry" banner, and distinguish error from empty in the list queries.

### A5. A failed draft load looks like "no draft exists" — and invites overwriting the real one
- **Role / job / frequency:** Assembler · J4 · any transient network/auth failure on open
- **Evidence:** `loadData`'s catch is `console.error(e)` only (`ProjectIMGenerator.tsx:341-345`); combined with `getProjectIM`'s catch-to-`null` (`project-im.service.ts:44-47`), a load failure renders the **template selection screen** (`ProjectIMGenerator.tsx:1757-1797`) as if the manual had never been started. If the operator picks a template and saves, `saveProjectIM` looks up the row by `(project_id, template_type)` and updates it in place (`project-im.service.ts:77-124`) — replacing the real draft's `placeholder_data` with the fresh empty state.
- **Consequence:** hours of assembly work overwritten by a well-intentioned second start. The local crash-draft won't save it: it's keyed per device (`ProjectIMGenerator.tsx:193`).
- **Blast radius:** one manual, but totally (all placeholder values, overrides, additions).
- **Smallest viable change (S):** distinguish "no row" from "load failed" in `getProjectIM` (throw or return a marker) and show an error-with-retry screen instead of the picker.

### A6. The XML (InDesign) export silently drops all block-based content and includes hidden chapters
- **Role / job / frequency:** Assembler · J4 (hand-off to layout) · per-launch where InDesign is used
- **Evidence:** `handleExport('xml')` iterates `orderedSections` and exports only `s.content[activeLang]` through `getCleanContent` (`ProjectIMGenerator.tsx:1503-1531`, esp. `:1516-1517`). It never calls `buildSectionHtml`/`resolveManual`, so inline block refs, shared safety blocks, per-project block overrides, section additions, and SKU slots are all absent; project-only sections export empty (their synthetic `content` is `{}`, `ProjectIMGenerator.tsx:2281-2291`). It also doesn't filter `isSectionEffectivelyVisible`, so hidden/excluded chapters are exported. The JSON export, by contrast, correctly uses `resolveManual` (`ProjectIMGenerator.tsx:1473-1502`).
- **Consequence:** anyone laying out a manual from the XML gets a document missing most of its safety content while containing chapters the assembler explicitly excluded (H12 — a data-losing exit door).
- **Blast radius:** the entire downstream document per export.
- **Smallest viable change (S):** build the XML from the same `resolveManual` output the JSON export uses.

### A7. The print PDF silently diverges from what the operator asked for
- **Role / job / frequency:** Assembler · J4 · every print export
- **Evidence:** four independent silent-divergence paths in one pipeline:
  1. Requested languages missing from the published manifest are dropped without warning — `ordered = req.languages.filter((l) => byLang.has(l))`, error only if **all** are missing (`netlify/functions/lib/print-render-shared.ts:107-122`). Reachable in practice: the "Export print PDF" path after "Already up to date" fabricates the language list from `requiredLanguages` without checking what is actually published (`ProjectIMGenerator.tsx:2668-2684`).
  2. Unresolved `{{attribute}}` tokens print as literal braces — `data[key] ?? `{{${key}}}`` (`src/services/im/im-resolver.ts:101-102`); nothing scans the output for them (compare the temp-highlight veto that *does* block publish, `im-publish.service.ts:240-250`).
  3. The stamped running footer/title strips all non-ASCII (`toAscii`, `netlify/functions/render-print-merge.ts:60-62,96,102`) — a Polish or Greek title is mutilated or emptied.
  4. The default font never loads: `Inter` is not in `GOOGLE_FONT_IMPORTS`, so default-font PDFs render in Arial (`src/services/im/im-print-html.ts:145-158`); and 7+ configured languages (bg, hr, et, el, lv, lt, sk, sl) have no display name, printing raw codes like "BG" on language dividers (`im-print-html.ts:168-173`).
- **Consequence:** a print-shop-ready booklet can be missing whole languages, contain `{{power_rating}}` as body text, or carry a corrupted footer — discovered only by reading the PDF, i.e. at the latest possible moment (H4).
- **Blast radius:** the physical printed artifact — the least reversible output in the whole workflow.
- **Smallest viable change (S):** fail (or warn loudly) when `ordered.length < req.languages.length`; scan resolved output for `{{` at publish like the temp-highlight veto; add Inter to the font imports. The ASCII stamping fix is M (embed a Unicode font in pdf-lib).

---

## 3. Ladder B — workflow gaps traced through code

### B1. There is no record of which market/locale has which published revision
- **Role / job / frequency:** Assembler · J4 ("for a market set") · per-launch, and continuously afterwards (J12: "where did this value come from / what is live?")
- **What the job needs:** publish 1 doc × N locales for a market set and afterwards answer "which revision is live in which market, since when, published by whom".
- **What the code supports:** no market entity exists anywhere (repo-wide, "market" appears only in comments, e.g. `src/config/im-languages.ts:6`). Publish is per-language with no version in the manifest (`im-publish.service.ts:281-288`); `published_by` is written to `im_publish_snapshots` (`im-publish.service.ts:263-271`) but **read by nothing** — there is no publish-history UI. Every print render, regardless of language set or page size, becomes another version of the single project document titled "Generated Manual" (`ProjectIMGenerator.tsx:864-892`), distinguishable only by parsing its filename. Producing N per-market files means N manual dialog runs, each re-selecting languages and re-typing the mandatory change note (cleared on success, `PrintExportDialog.tsx:149-150` + post-success reset).
- **What they do today instead:** `[Guessing]` a spreadsheet mapping markets → languages → last-sent PDF, or memory. The data model guarantees it happens outside the tool.
- **Heuristic:** H3 (provenance at point of decision), H7 (multi-locale is the default path), H12.
- **Cost / risk:** every launch × every market; the failure mode is a market receiving a stale or wrong-language manual — regulatory.
- **Smallest viable change (L, needs a spec):** a market entity with market → language mapping and per-market publication records. **S mitigation (70% of the value):** a read-only publish-history panel on the project IM tab, fed by the already-populated `im_publish_snapshots` (per-language hash, `published_at`, `published_by`) and `im_print_renders` — the data is already being written; nothing displays it.

### B2. Public share links can be created but never listed or revoked in the app
- **Role / job / frequency:** Assembler / director · J4 side effect (distributing the published manual) · per-launch
- **What the job needs:** hand a supplier/distributor a link; later, know which links exist and kill one.
- **What the code supports:** `createIMShare` has a UI (`src/pages/im/IMViewerTab.tsx:43-56`); `getIMShares` and `revokeIMShare` exist (`src/services/im/im-share.service.ts:33-70`) but have **zero UI callers** (verified: only barrel re-exports reference them). Links have no expiry, no label/recipient field, no access log (`db_migrations/84_create_im_shares.sql`), and the URL is shown once then discarded from state. Live RLS confirms any authenticated user can read/modify any share row.
- **What they do today instead:** `[Guessing]` nothing — links accumulate forever, unrecorded.
- **Heuristic:** H5 (blast radius must be visible), H12.
- **Cost / risk:** a revocation capability that is documented in the code ("the public URL stops resolving immediately", `im-share.service.ts:67`) is unreachable; compliance exposure when an outdated manual keeps circulating. Note also that a link silently starts serving new content after every republish (deterministic manifest URL, `im-publish.service.ts:164-171`).
- **Smallest viable change (S):** a "Share links" list with revoke buttons in `IMViewerTab` — both service functions already exist.

### B3. The FINAL sign-off is advisory and anonymous
- **Role / job / frequency:** Assembler / process owner · J4 (sign-off is the end of the assembly job) · per-launch
- **What the job needs:** "FINAL" must mean the published artifact can't change, and an auditor must see who signed it off.
- **What the code supports:** verified against the **live DB**: the finalize-lock triggers exist for `im_templates`/`im_sections` only; `project_ims` has **no trigger** (migration `98_add_finalization_to_project_ims.sql` adds only the columns). The code acknowledges this (`project-im.service.ts:216-220`: "the lock is enforced in the editor only"). Neither `publishResolvedManuals` (`im-publish.service.ts:197-293`) nor `republishProjectIM` (`im-staleness.service.ts:200-210`) nor `deleteProjectIM` (`project-im.service.ts:182-187`, a hard delete) checks `isFinalized`. There is no `finalized_by` column — sign-off records when, never who (`project-im.service.ts:164-177`). Delete also leaves the published JSON publicly readable and share links resolving (both FK to `projects`, not `project_ims`). Adjacent, live-verified: `im_print_renders` grants DELETE to every authenticated user (`qual: true`) — the compliance changelog is deletable by anyone signed in.
- **What they do today instead:** trust the UI lock; sign-off identity lives in chat/email `[Guessing]`.
- **Heuristic:** H3, H5.
- **Cost / risk:** low frequency, maximal stakes: a signed-off manual can be silently republished, deleted, or its render history erased, and no signer is recorded.
- **Smallest viable change (S):** check `isFinalized` in `publishResolvedManuals`/`republishProjectIM`/`deleteProjectIM`. **M:** a `project_ims` trigger mirroring migration 87, a `finalized_by` column, and tightening the `im_print_renders` DELETE policy.

### B4. Concurrent editing is last-write-wins, amplified by 4-second autosave
- **Role / job / frequency:** Author + Assembler · J3→J4 handoff (two named roles on the same object, per `users-and-jobs.md`) · per-launch
- **What the job needs:** the author/assembler boundary is "a deliberate design decision" — two people will touch the same manual around handoff.
- **What the code supports:** `saveProjectIM` looks the row up and updates it in place with the full payload — no `updated_at` precondition, no conflict detection (`project-im.service.ts:77-124`). The debounced autosave fires 4s after any edit (`ProjectIMGenerator.tsx:694-701`). Two open tabs/people silently overwrite each other's entire overlay state every few seconds; the crash-draft is per-device and can't help. There is also no explicit handoff state ("ready for assembly" / "returned with comments") — only `draft`/`generated` + the FINAL flag (H11).
- **What they do today instead:** `[Guessing]` coordinate via Teams ("are you out of the manual?").
- **Heuristic:** H9 (long-form work must survive the session — including the *other* person's session), H11.
- **Cost / risk:** intermittent, hard-to-attribute loss of placeholder values and overrides; erodes trust in the tool exactly at handoff.
- **Smallest viable change (M):** optimistic concurrency — send the baseline `updated_at`, reject on mismatch with a "reload & merge" prompt. **S mitigation:** show "last saved by X at T" (requires adding `updated_by`, one column) so collisions are at least visible.

---

## 4. Ladder C — heuristic violations, cost unobserved

### C1. Per-block overrides are keyed by position and silently re-point when the template changes — H6
- **Evidence:** ref visibility overrides and per-project block edits are keyed `${sectionId}:${index}` in the generator (`ProjectIMGenerator.tsx:86,1945-1949`), persisted as `refvis_…`/`blockOverrides[sectionId][index]`, and consumed positionally by the resolver (`im-resolver.ts:498-508`). Inserting, deleting, or reordering a `blockRef` in the template editor shifts every downstream project's overrides onto **different blocks** — an excluded warning becomes included, an edited table override lands on the wrong block — with no warning to anyone.
- **Why it probably costs something:** templates are living documents here (the whole staleness subsystem exists because they change after publish); every already-configured project is exposed on each structural template edit.
- **What would confirm it:** one check — has any template with dependent generated manuals had blockRefs inserted/reordered since those manuals were configured? (Comparable via `im_publish_snapshots` history.)
- **Smallest viable change (M):** give each blockRef a stable id at template-save time and key overrides by it; migrate existing keys by position once.

---

## 5. Ladder D — speculative (max 3)

### D1. Per-market export profiles for the print dialog
- **Claim:** `[Guessing]` assemblers produce several per-market booklet variants per launch (e.g. DE for DACH, FR+NL for Belgium) and currently re-drive the print dialog once per variant — reselecting languages, page size, and re-typing the change note each time (`PrintExportDialog.tsx:149-162` + post-success reset).
- **Who it would serve and how often:** Assembler, per-launch × number of market variants — `[Guessing]` 3–10 runs per launch.
- **What would promote or kill it:** ask Anabelle/the assembler how many distinct print files a typical launch produces and how they decide language sets per market. If the answer is "one combined booklet, always", kill it; if it's a list per market, promote it and fold it into B1's market model.
- **If admitted despite the banned list:** not on the banned list; it's a saved-configuration feature tied to a specific re-entry cost traced in code.

---

## Implementation addendum (2026-08-17/18)

Five implementation rounds followed this audit. Everything below is code-complete and verified
(tsc clean, vitest green apart from 3 pre-existing translation.service failures, Netlify
functions bundle) but **migrations 102–110 in `db_migrations/` are NOT applied to the live DB**
— apply in order before deploying (104/102 hard-block saving/finalizing; 106/107 shares/markets).

**Rounds 1–4 (summarized):** XML export removed; preview/publish condition-default divergence
fixed; republish bumps versions; print failures surface as 422s (no silent divergence); publish
history + FINAL lock server-side (102/103); stable blockRef ids (fixes C1); optimistic
concurrency + `updated_by` (fixes B4); daily rolling backups (3 days); the inline-editor
round-trip fixes (nested lists, callouts, chip click-to-edit, Excel paste, alt text, stale-
translation dots); print idempotency per jobId; per-language staleness ("Out of date in: DE,
FR"); share label/expiry/revoked_by; XLIFF verbatim hard-fail + overwrite preview + durable
import reports (108); admin-configured Markets (107) with print-dialog presets + render stamps
(supersedes D1's open question with a v1).

**Round 5 (2026-08-18):**
1. **Publish diff** — `im-publish-diff.service.ts` compares the stored snapshot manuals against
   a fresh re-resolve (canonical stringify; jsonb key reordering handled) and reports
   changed/added/removed/moved sections per language. Surfaced as "What changed?" →
   `PublishDiffModal` on IM-dashboard stale rows and both ProjectDetail stale panels.
2. **Verbatim publish preflight** — `findVerbatimViolations` in `im-publish.service.ts`: every
   mandated phrase present in the EN output must appear as its approved wording in each other
   published language (whitespace-insensitive, case-sensitive). Warns per language on ordinary
   manuals; hard-blocks FINAL manuals (including when the verbatim list fails to load).
3. **TOC page numbers + link repair** — `collectInternalLinks`/`stampTocPageNumbers` in
   `render-print-merge.ts`: link targets resolved per part BEFORE copyPages (pdf-lib's copier
   orphans destination pages — the merged booklet's clickable TOC links were silently dead),
   translated by part offset, page numbers stamped right-aligned into each TOC row's link rect,
   annotations re-pointed at the real pages. TOC rows reserve 10mm right padding. Verified
   end-to-end against synthetic /Dest- and /GoTo-style links.
4. **Share access logging** — migration 109 turns `get_im_share_by_token` into
   UPDATE…RETURNING stamping `last_used_at`/`use_count`; viewer tab shows "opened N× · last
   {date}" / "never opened".
5. **DB-level admin gates** — migration 110: `im_markets` writes admin-only (reads stay open),
   FINAL **unlock** admin-only via the extended 102 trigger (locking stays open to all;
   service-role/SQL contexts exempt).
6. **Image weight preflight** — `im-print-preflight.service.ts` reads the published JSONs,
   collects every image with its sections/languages, HEADs each unique URL, and the print
   dialog shows an advisory "N large images (≥ 1 MB)" panel filtered to the selected languages.
   Never blocks a render.

**Round 6 (2026-08-18) — editor:**
1. **Per-language spellcheck** — the contentEditable now carries `lang={activeCode}` +
   `spellCheck`, so the browser checks German prose with a German dictionary. Applies to
   both the template editor and the generator (shared `InlineHtmlRow`).
2. **English reference pane** — editing any non-EN tab shows the current English source
   read-only above the editor (collapsible; preference persisted globally), with an inline
   "English was edited after this translation" notice. Completes the stale-dot workflow.
3. **Template-wide find & replace** — `im-find-replace.ts` (chip-safe: chips/<img>/markup
   frozen via im-chip-freeze + tag segmentation; prose-only replacement, tag-boundary
   matches deliberately not found) + a modal in the template editor: search all sections ×
   languages (inline rows, titles; shared blocks listed read-only), selective replace,
   FINAL-locked templates can search but not replace.
4. **Focus mode** — a Focus button on the section editor moves the SAME editor fullscreen
   with a live preview of just that section beside it (deferred-render so typing stays
   responsive); Esc exits. Template editor only — the generator keeps its preview drawer.

**Round 7 (2026-08-18) — re-entry costs:**
1. **Duplicate template into another category** — `duplicateIMTemplate` (im-template.service):
   clones the template row (languages + metadata, never FINAL) and all sections in
   parents-first waves with fresh section ids (parent links remapped) and FRESH block-ref
   ids (project-override keys must not be inheritable); shared-block references stay
   pointed at the library. Copy icon on each template row in IM dashboard → Category
   Templates, target limited to categories without a template of that type; a mid-way
   failure reports the partial clone loudly. Unit-tested (wave order, id remap, ref-id strip).
2. **Start from a sibling project** — on the generator's template-picker screen, projects
   in the same category with a manual of this type can seed the new manual: copies the
   CURATED setup (cond_/secvis_/refvis_ toggles, __required_languages/__language_order,
   __field_bindings wiring, brand logo/footer) and deliberately never product attribute
   values, SKU content/scoping, or the cover title; field wiring re-derives values from
   this project's attributes. Optional checkbox also copies text additions/edited blocks.
   Nothing persists until the user saves.

**Round 8 (2026-08-18) — workflow layer (solo-operator):**
1. **Pipeline stepper** (`project-im-generator/PipelineStepper.tsx`) — the generator header
   shows Content → Translation → Published → Review (optional) → Final → Print, each step
   derived live (checklist counts, translation gaps, publish version + deferred staleness
   check, review round + polled outcome, FINAL, newest render version) and clickable to
   its action. Answers "where was I here" on open.
2. **Dashboard work queue** — `nextActionOf` (im-manual-status.ts, tested) renders a per-row
   "what next" hint: "edited after v3 — publish to update", "review out 5 days · 3 open
   threads", "review finished — mark FINAL", "print PDF is v3 — regenerate for v5",
   "no print PDF yet". Print freshness comes from a new one-query
   `getLatestRendersByManual` sweep. Quiet (no line) when nothing is actionable.
3. **Markup.io review outcome** — new `markup-review-status` Netlify function GETs
   /api/v2/markups/{id} (status enum, activeThreads, projectReviews), derives done
   (completed/approved status OR ≥1 explicit approval), and caches it on project_ims
   (migration 112). New derived status **Review done** (between draft and In Review in
   the work order); dashboard auto-polls rows in review (pool of 3, ≤12) and the
   generator polls once per open; a new review round clears the previous outcome.
   Deleted markups are detected and recorded. Editing/republishing still ends the round
   implicitly — a stale cached outcome cannot resurrect it (tested).

---

## 6. Ranked shortlist

| # | Finding | Ladder | Role | Freq | Risk | Fix | Why this order |
|---|---|---|---|---|---|---|---|
| 1 | A1 preview/publish divergence on no-data conditions | A | Assembler | per-launch | regulatory: chapter silently missing from legal doc | S | Silent, invisible, compliance-visible, cheap fix |
| 2 | A2 republish under same version → print guard says "current" | A | Assembler | per correction | regulatory: printed ≠ published | S/M | Actively misleads the operator into not reprinting |
| 3 | A7 print PDF silently diverges (languages dropped, literal tokens, ASCII footer) | A | Assembler | per export | regulatory: defective physical artifact | S | Least reversible output; failures surface last |
| 4 | A5 failed load → overwrite path | A | Assembler | rare | total loss of one manual's assembly work | S | Data loss with an innocent trigger |
| 5 | A3 non-atomic publish, swallowed snapshots | A | Assembler | per publish | mixed-state public bucket | S | Undermines both publish and staleness trust |
| 6 | A4 failed checks render green | A | All reviewers | weekly+ | stale manuals invisible | S | The dashboard's one job |
| 7 | B3 FINAL lock advisory, no signer, open history DELETE | B | Process owner | per-launch | audit-trail gap | S→M | Low frequency, maximal stakes |
| 8 | B1 no market/revision record | B | Assembler | per-launch + ongoing | wrong/stale manual per market | L (S mitigation) | Core of "for a market set"; data already captured, just unshown |
| 9 | B2 share links unlistable/unrevocable | B | Assembler | per-launch | outdated manuals keep circulating | S | Both functions already exist |
| 10 | A6 XML export drops block content | A | Assembler | per-launch (if used) | broken layout hand-off | S | A-grade defect, but usage unconfirmed (see question) |
| 11 | B4 last-write-wins concurrent editing | B | Author+Assembler | per-launch | silent work loss at handoff | M | Real but intermittent |
| 12 | C1 positional override keys | C | PM/Assembler | on template edits | overrides re-point silently | M | Structural hazard, cost unobserved |

(A6 is ranked below several B findings deliberately: the defect is certain but the job step — InDesign hand-off — is unconfirmed.)

---

## 7. Coverage

**Examined:** `src/pages/im/ProjectIMGenerator.tsx` (fully), `PrintExportDialog.tsx`, `OptionalContentPanel.tsx`, `BindableField.tsx`, `IMViewerTab.tsx`, `IMDashboard.tsx` (All Manuals tab), `ProjectDetail.tsx` (IM tab), `im-manual-status.ts`; services `im-publish`, `im-staleness`, `im-share`, `project-im`, `im-resolver`, `im-print-export`, `im-print-html`, `im-chip-freeze`, translation export/import + XLIFF codec; Netlify functions `render-print-{prepare,part,merge,cleanup}` + `lib/print-render-shared.ts`; routing/auth (`App.tsx`, `ProtectedRoute`, `AdminRoute`, `AuthContext`); migrations 46, 48, 54, 67, 68, 84, 87, 98, 99; **live DB** triggers and RLS policies on `project_ims`, `im_templates`, `im_sections`, `im_print_renders`, `im_shares`, `im_publish_snapshots` (per the standing note that repo migrations drift from prod).
**Not examined:** `IMTemplateEditor.tsx` (J3 template authoring — only its translation-import path was traced), `im-import.service` and the import dialogs (J5 supplier intake), `IMBlockLibrary`, the `im-viewer` module internals, `IMPreview`/`IMSharedManual` rendering, asset/asset-library services, the AI translation service internals, supplier portals.
**Blocked / could not verify:** real data volumes (number of manuals, languages per manual, template-edit frequency — needed to firm up C1 and B4); whether the XML/InDesign export is actually used; actual PDF output fidelity (no running render); who performs the assembler role in practice.
**Corrections needed in `users-and-jobs.md`:** J4's "what they do today instead" can now be partially filled: market↔language mapping and per-market revision bookkeeping necessarily happen outside the tool (no market model exists — B1). The Assembler role identity is still `[Guessing]` — the app has no role gate distinguishing author from assembler (any authenticated user, including SUPPLIER-role accounts, can open any project's generator and publish: `ProtectedRoute.tsx` checks only `isAuthenticated`, `App.tsx:144-148`), so the boundary noted as "a deliberate design decision" is social, not enforced.

---

One question, since it decides A6's priority: **is the XML (InDesign) export actually used in the layout hand-off, or is the print-PDF pipeline the only real output path?** If unused, A6 drops to "delete the menu item"; if used, it belongs in the top three.
