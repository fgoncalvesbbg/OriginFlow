# Design Specs — version review & comparison

Status: **All four steps complete (2026-09-09).** Migration 169 applied and verified live.

Extends [originflow-design-specs-module.md](originflow-design-specs-module.md). That plan
built the registry, the versions and the supplier round. This one is about **reading a
review back**: seeing which notes were left against which version, switching between
versions, and comparing two of them side by side.

## The problem, in the words it was reported in

> "What I usually struggle with in MarkUp is that whenever I make comments and they fix the
> document, they just upload a new document — it doesn't manage versions. So whenever I need
> to check the second version, I need to remember which were the things I flagged. If this
> one can manage versions and I can easily switch from one to the other, and I can see the
> comments in the previous version, it would make everything very smooth."

Three separate asks, and they are not equally expensive:

1. **Versions are kept, not overwritten.** Already true.
2. **Switch between them and see each one's comments.** Needs a viewer we do not have.
3. **Compare two versions side by side.** Needs a new surface.

## What already exists (verified live, project `ecueltibpmpnhnaxlskx`, 2026-09-09)

The data model never had the Markup.io problem. Nothing below needs building.

- **`design_spec_versions`** holds `version` (assigned server-side by a trigger, so two
  concurrent uploads cannot both claim v3), `storage_path` (the design team's original,
  never mutated), `stamped_path`, `page_count`, `byte_size`, `note`, `uploaded_at/by`.
  Uploading a fix creates a row; it does not replace one. v1's bytes survive v7.
- **`review_comments` carries the version on every note** — `subject_id` = the
  `design_spec_versions.id`, `subject_version` = the number — plus `page` and
  `anchor_x/y/w/h` as **fractions of the page**, not points. "Which things did I flag on v1"
  is a fact in the database already.
- **The internal panel already reads every note across every version.**
  [`getDesignSpecNotes`](../src/services/design/design-spec-notes.service.ts) deliberately
  omits the version id, which is sound because one-spec-per-project is a constraint. The
  version list already prints "N notes against this version".

## What is missing

| Gap | Where |
|---|---|
| No in-app PDF viewer on the internal side | [`openFile`](../src/pages/design/ProjectDesignSpecPanel.tsx) opens a signed URL in a browser tab. Pins are not drawn. |
| `PdfReviewCanvas` is reachable only by suppliers | Used solely by `DesignSpecReviewPortal`. The internal team cannot see the pins it draws. |
| No version switcher | There is no surface to switch *on*. |
| No comparison | — |
| A supplier on a v2 link sees none of their v1 notes | `review_list_comments` scopes by share, deliberately, so Factory A cannot read Factory B's notes. |

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Where the viewer lives | Full-screen overlay from the project's Design Spec tab | A PDF needs the viewport; the tab is already a scrolling column of cards |
| Which bytes the internal viewer shows | The **original**, not the DRAFT-stamped copy | Internal readers are entitled to it, and the stamp obscures the artwork being reviewed |
| How the file is fetched | Download once to a blob URL, cache per version | Signed URLs live 5 minutes; pdf.js fetches page ranges lazily, so a long compare session would 403 mid-scroll on a raw signed URL |
| Version switching | Remount the canvas with `key={versionId}` | `PdfReviewCanvas` does not reset `loading`/`error`/`pages` when `fileUrl` changes — a remount is correct and touches no code the live supplier portal runs |
| Triage in the viewer | **Not** in step 1 | Status/reply UI stays in the panel below; duplicating it is a step-3 decision once ghost pins exist |
| Cross-version note visibility (internal) | Rail toggles *This version* / *All versions*; clicking another version's note switches to it | This is the literal ask, and costs nothing — the notes are already loaded |
| Cross-version note visibility (supplier) | Chain shares with `supersedes_id`, never "all notes for the spec" | Per-spec would leak Factory A's notes to Factory B |
| Compare scroll sync | Page number + fraction scrolled within the page | Pixel sync breaks the moment two versions differ in page size or count |
| Carrying notes forward | Ghost pins at the same fractional coords, on the same page number | Fractional anchors map across versions for free; page *insertions* still drift, so the operator gets a page-offset nudge |

## Steps

### Step 1 — internal version viewer (frontend only)

New `src/pages/design/DesignSpecVersionViewer.tsx`: a full-screen overlay with a version
selector, `PdfReviewCanvas` in `readOnly` mode, and a note rail beside it. Clicking a pin
focuses its note; clicking a note focuses its pin. The rail toggles between this version's
notes and every version's, and picking a note from another version switches the viewer to
that version.

`pdf.js` must stay out of the main chunk — the canvas is `React.lazy`-imported here exactly
as `DesignSpecReviewPortal` does it, for the same reason (~350KB that every user of the app
would otherwise download).

Solves ask 1 and ask 2. No migration, no server change.

**What shipped:**

- [`DesignSpecVersionViewer.tsx`](../src/pages/design/DesignSpecVersionViewer.tsx) — the
  overlay: a version switcher carrying each version's note count, the read-only canvas, and
  a rail that toggles *This version* / *All versions*. Picking another version's note from
  the rail switches the viewer to it.
- [`fetchDesignSpecObject`](../src/services/design/design-spec-file.service.ts) — downloads
  a version once to a `blob:` URL. The viewer holds at most **two** (`BLOB_CACHE_LIMIT`),
  evicting least-recently-used, and revokes every one on close.
- The version row's buttons are now **View** (this overlay) and **Original** (the old
  new-tab open, renamed — it serves the unstamped original, and next to "View" the old
  "Open" said nothing about which of the two it meant). The "N notes against this version"
  line is now a link into the viewer.

Rail pin numbers are computed with `orderByAnchor`, the same page-then-y-then-createdAt
order `PdfReviewCanvas` numbers its pins by, so the two agree by construction rather than by
coincidence. A note from another version shows a dot instead of a number — there is no pin
bearing that number on the pages currently rendered, and labelling it would send the reader
looking for something that is not there.

### Step 2 — side-by-side compare

Two canvases in one overlay, version A left, version B right, scroll-synced by page number
plus intra-page fraction. When the page counts differ, offer a page-offset nudge and a
toggle to unlink scrolling rather than pretending the mapping is right. Each side keeps its
own pins.

**What shipped:**

- A **Compare…** picker in the viewer header. Panes render **lower version number on the
  left**, whichever one was picked first: a reader comparing v2 with v3 is reading a before
  and an after, and putting the after on the left inverts every judgement about what changed.
  Clicking the compared version in the switcher swaps the two rather than colliding.
- [`compare-scroll.ts`](../src/pages/design/compare-scroll.ts) — the mapping, pure and
  DOM-free, with [15 tests](../src/pages/design/compare-scroll.test.ts). A position is
  *(page, fraction into that page)*, so it survives different page sizes, different page
  counts, and **a different zoom on each side**. A scroll position in the gap between two
  pages reads as the bottom of the earlier one, never the top of the next — rounding it
  forward would jump the other pane a page ahead while the reader is still on the previous.
- **Sync scroll** toggle and a **page-offset** stepper, both in the header. Changing either
  re-aligns immediately rather than at the next scroll, or the control looks broken.
- Sync is one-way per gesture: the pane the reader last touched drives, and the echo the
  other pane emits when its `scrollTop` is set is ignored. A flag cleared on a timer would
  either fight a fast trackpad or wedge shut when a programmatic scroll lands where the pane
  already was and fires no event.
- **Jump to a note.** Clicking a note in the rail scrolls its pane to the pin — switching
  version first if that note belongs to one not on screen, and retrying while the newly
  mounted canvas parses its PDF (bounded, 5s). This was missing from step 1, where focusing a
  note only enlarged a pin the reader might have to hunt for.
- One additive prop on the shared canvas: `onScrollElement`, handing the caller its scroll
  container. Read through a ref, so an inline arrow does not detach the container or restart
  its ResizeObserver. The supplier portal passes nothing and is unaffected.

Pin numbers are computed **per version**, because in compare mode two notes legitimately both
wear a "1" — each pane numbers its own pins from 1. The version badge beside the number is
what tells them apart.

### Step 3 — carry the previous round's notes onto the new version — **shipped**

**The design changed once the schema was checked.** The plan was to copy an unresolved note
onto the new version so it would carry a v(N+1) anchor. That was dropped:
`review_comments.share_id` is `NOT NULL`, every note in the system belongs to a supplier's
review link, and that invariant is worth more than the convenience — a copy would also have
put words in a supplier's mouth on a round they never saw.

What shipped instead keeps the original note as the only record and adds **one fact**:
`review_comments.checked_subject_id/_version` — the version a note was last triaged against.
That is precisely what `status` cannot express, since an open note nobody has re-checked and
an open note confirmed still wrong look identical without it.

- **Ghost pins.** `PdfReviewCanvas` gained an optional `ghostComments` prop, drawn as hollow
  dashed rings. **Unnumbered on purpose** — a number would come from another version's
  numbering, where that digit already belongs to a different pin, so it would point the
  reader at the wrong note in the rail.
- **Every earlier version, not just N−1.** A note left open through v1 and v2 is exactly the
  one most at risk of being forgotten; dropping it when v3 arrives would rebuild the problem.
- **Three verdicts** in the viewer's rail: *Fixed in vN*, *Still an issue*, *Not changing*
  (plus *Reopen*). All are recorded against the **newest version on screen** — in compare mode
  two are visible, and nobody decides a note is fixed by looking at the older copy.
- The rail says which of the three states a note is in: `Not re-checked since v1`,
  `Confirmed still an issue on v3`, or `Last checked against v2`.
- A **Carry over** toggle in the header turns the whole thing off.

`setReviewCommentStatus` takes the version as an optional argument and **omits the columns
entirely when it is absent** rather than writing null — a triage action taken from the panel's
plain list must not erase the knowledge that someone checked the note against v3 last week.
Four tests in
[`review-comments.service.test.ts`](../src/services/review/review-comments.service.test.ts)
pin that down.

The drift caveat stands and is stated in the UI: a ghost says "the last round flagged this
spot on ITS copy", never "the problem is here now". A page inserted between versions shifts
every ghost after it, and the compare view's page-offset control is the correction.

### Step 4 — let a supplier see their own history — **shipped**

`review_shares.supersedes_id` chains a round to the one it succeeds, and
`review_list_prior_comments(token)` walks that chain backwards from the token in hand.

- **A new rpc, deliberately not a widening of `review_list_comments`.** That function feeds
  the portal's live rail, whose pins are drawn on the version currently on screen. Returning
  an earlier version's notes through it would scatter pins from another document across this
  one and offer the reviewer Delete and Reply on a round that is closed. Prior rounds are a
  separate, strictly read-only list.
- **A trigger keeps a chain inside one project and one document type**, and refuses a cycle
  (depth-capped walk). Without the first check, pointing a new link at any share in the system
  would expose that share's notes to this link's holder.
- **Ancestors are not re-checked for revocation.** A finished round always has a revoked or
  expired link — that is what "finished" looks like. The live gate is the anchor token, so
  revoking the current link still cuts the whole history off.
- **Supplier UI**: the portal rail gains a collapsed *"What you asked for last round"* section,
  and the PDF surface draws those notes as the same hollow rings the internal viewer uses.
- **Internal UI**: the send dialog asks *"Is this the next round for someone?"* and lists the
  links minted on other versions. Per-recipient on purpose — pointing every round-two link at
  the whole document's history would show each supplier every other supplier's notes.

Migration [`169_review_carry_forward.sql`](../db_migrations/169_review_carry_forward.sql),
applied to `ecueltibpmpnhnaxlskx` on 2026-09-09 and verified live:

| Check | Result |
|---|---|
| Columns, constraint, index, trigger, grants | all present |
| Cross-project chain | rejected with the written message |
| Same-project chain | accepted |
| Prior notes before chaining | 0 |
| Prior notes after chaining | 1 |
| Live rail after chaining | 3, unchanged |
| Unrelated token | sees 0 |

Every functional test ran inside a transaction that was rolled back; the table counts after
were unchanged (9 shares, 8 comments, 0 rows carrying `supersedes_id`).

## Risks

- **Memory.** Blob-caching two 50MB specs for a compare is 100MB of tab. Cap the cache at
  the two versions in view and revoke object URLs on close.
- **`PdfReviewCanvas` is shared with the live supplier portal.** Step 1 adds a prop-free
  usage and a `key`; it must not change the portal's behaviour. Its stale-`fileUrl` reset
  bug is real but is worked around rather than fixed, precisely so the portal is untouched.
- **Ghost-pin drift (step 3)** is the one place this feature can quietly mislead. It must
  read as "v1's note was here on v1", never as "this is where the problem is now". Both
  surfaces say so in words; the page-offset control is the correction.
- **Chaining is a manual choice made at send time.** Nothing infers that "Factory A" on v3 is
  the same recipient as "Factory A" on v2 — matching on a free-text label would eventually
  hand one supplier another's notes. The cost is that forgetting to pick the previous link
  simply means the reviewer does not see their history, which is the safe direction.
- **Not yet driven in a browser.** Typecheck, 2286 unit tests and the production build all
  pass, and the database half is verified against the live project, but no one has clicked
  through the viewer, the compare panes or a chained supplier link.
