# Porting Attribute Viewer, SP Matrix and Roadmap Creator to OriginFlow

**Goal:** run these three modules inside OriginFlow so OriginFlow is *self-sustaining* — no Akeneo
process behind it, no PIM round trip on any request path — while keeping the features, the data
model and the UI/UX that make each one work.

**Verdict up front, because it changes how much work each one is:**

| Module | Akeneo dependency today | Port difficulty |
|---|---|---|
| **Roadmap Creator** | **None in its own code.** One *optional, lazy, click-to-load* cross-app panel + Jira. | **Trivial** — delete one panel, or repoint it at OriginFlow's own attribute store. |
| **SP Matrix** | **One field.** The `L` flag (Akeneo's `substitution` association). `in_akeneo` is a *warehouse view*, not the PIM API. | **Easy** — the PIM half is already built to degrade (`assocStatus: "skipped"`). |
| **Attribute Viewer** | **Structural.** Akeneo *is* the value source, the option vocabulary, the type system and the export target. | **Real work** — needs OriginFlow to become the system of record, described in §4.4. |

---

## 0. The platform the three modules sit in

All three are apps in one modular React + Express platform. Copy the *shape*, not just the apps —
most of what makes them robust lives in this layer.

### 0.1 Structure

```
src/
  apps/registry.js            ← THE only place an app is declared (sidebar + routing + code-split)
  apps/<id>/<Id>App.jsx       ← one root component per app
  apps/<id>/components/*.jsx  ← presentational, dumb
  apps/<id>/lib/*.js          ← PURE logic (grid maths, filters, CSV) — no React, no fetch
  apps/<id>/styles.css        ← scoped under one class prefix; cannot reach another app
  shared/PlatformProvider.jsx ← gives every app `apiBase` + `actor`
server/
  apps/<id>/routes.js         ← HTTP shape only, no business logic
  apps/<id>/repository.js     ← all SQL
  apps/<id>/schema.sql        ← idempotent DDL, run on boot by shared/db/migrate.js
  shared/product/             ← the shared product cache (see 0.3)
  shared/connectors/          ← akeneo, eprel, jira, originflow, warehouse
  shared/auth/                ← SSO session + per-module permissions
```

Source: [src/apps/registry.js](src/apps/registry.js) · [server/shared/db/migrate.js](server/shared/db/migrate.js)

### 0.2 Rules worth carrying over verbatim

- **One registry entry per app.** Adding/removing an app touches one file plus one folder.
  `React.lazy` per app, each wrapped in an error boundary — a broken app can't take down the shell.
- **Apps never import another app's files** (CSS included). Duplication is the accepted cost.
  The only cross-app coupling in the whole platform is one deliberate HTTP call
  (Roadmap → Attribute Viewer `/compare`), and its comment says why.
- **Pure `lib/`.** "Why is this SKU hidden?" is answerable by reading one function, unit-tested
  against fixtures. Every module has this and it is the reason the grids are maintainable.
- **Routes validate, repositories do SQL, `lib/` decides meaning.** No business logic in a router.
- **Reads open, writes barriered.** A positional `router.use(requirePermission(...))` sits at the
  line where writes begin, so a write route added later *cannot* be left unprotected by forgetting
  a line. See [server/apps/roadmap/routes.js:139](server/apps/roadmap/routes.js#L139).
- **Append-only audit in every module.** `*_audit` table, before/after JSON, actor, timestamp.
- **State the age of the data.** Every module has a tile or strip saying *how* it was read and
  *when*. "A page that shows data without saying how old it is gets trusted as live."

### 0.3 The shared product cache — port this first

[server/shared/product/repository.js](server/shared/product/repository.js) ·
[schema.sql](server/shared/product/schema.sql)

`dbo.product_item` is a local mirror of the warehouse product master. **Every module reads product
facts from here, never from the warehouse on a request path.** The reason is measured: the same
Synapse scan took 0.9s–26s depending on company-wide load, which shows up as a timeout, not a slow
page.

Two halves, and the split is the design:

- `refresh()` — the full warehouse pull. Minutes. Never on a request path; it's a button.
- `get*()` — plain local reads. Milliseconds. What every request uses.
- `ensureItems()` — one narrow exception: a targeted read of *named* item numbers missing from the
  cache, so a brand-new launch is workable before the next full refresh.

Sources it pulls (all four are **warehouse views, not APIs**):

| Source | Gives |
|---|---|
| `PL.PL_V_ITEM` | item no, type, EOL status, category L1–L4, brand, description, supplier, EAN, launch date, price |
| `L0.L0_AKENEO_ITEM_FAMILY` | `in_akeneo`, `akeneo_family` — **this is a warehouse table, not the PIM API** |
| `L0.L0_SHOP_FEED_MASTER` | `in_shop`, `shop_url`, availability, quantity, price, feed date |
| Akeneo REST (`substitution`) | *only* the spare-part associations, and already optional |

> **Key finding for the port:** "is this SKU in Akeneo" costs zero Akeneo calls today. The only
> live-PIM part of the refresh is wrapped in its own try/catch and recorded as
> `assocStatus: "skipped" | "ok" | "failed"` — a PIM outage does not throw away a successful
> warehouse pull. Dropping Akeneo entirely means dropping exactly one field.

**Scope rule to keep:** the cache holds everything *except* discontinued —
`ItemStatusMI IS NULL OR <> '-1'`, written that way on purpose. `= 0` silently dropped every item
with no MI master data, which is disproportionately the newest items and the ones most likely to be
missing from the PIM — exactly the population a data-quality tool exists to find. On one category
that was 143 items instead of 115.

### 0.4 Write protection

Two independent facts, and both are enforced server-side:

- **Permission** — SSO session + per-module role (`requirePermission(module, "editor")`).
- **Edit lock** — a shared password per module (`ATTRIBUTE_VIEWER_EDIT_PASSWORD`,
  `SP_MATRIX_EDIT_PASSWORD`), checked on every write. The client-side `useEditLock()` hook only
  decides *what the UI offers*, so nobody fills in twenty fields before discovering they can't save.

Sources: [server/shared/auth/requirePermission.js](server/shared/auth/requirePermission.js) ·
[src/apps/attribute-viewer/hooks/useEditLock.js](src/apps/attribute-viewer/hooks/useEditLock.js)

### 0.5 The design system (all three share it)

Full spec: [DESIGN.md](DESIGN.md). North star: *"The control room, dressed for the Klarstein
storefront"* — a fixed dark rail framing a bright, uncluttered canvas.

| Token | Value | Rule |
|---|---|---|
| Ink | `#0d0d0d` | rail background *and* body text |
| Canvas | `#f8f5f2` | cream app background |
| Surface | `#ffffff` | cards, panels, dropdowns |
| Border | `#ebebeb` | hairlines |
| Secondary / muted text | `#4a4a4a` / `#757575` | |
| **Coral** | `#fc7c5a` (hover `#fc9175`) | **FILL ONLY**, always with dark text. Never coral text on light. |
| **Indigo** | `#6062f6` (hover `#4446af`) | the accent *as text*: links, "selected" labels, active tabs |
| Success / Warning / Danger | `#4da25d` / `#b45309` / `#ea1903` | tinted pill: light bg + saturated text + matching border |

Radii: input 4px · card 6px · modal 8px · **button/badge/chip = full pill (999px)**.
Shadows: flyout `0 8px 24px rgba(0,0,0,.11)` · modal `0 16px 40px rgba(0,0,0,.18)`.
Motion: **100ms linear**. Press: **opacity drop to 0.65** — never a shadow, never a scale.
Type: **Open Sans everywhere**; BwKlarstein *only* on the wordmark and a page's `h1`.

Named rules that shape every screen below:

- **State-Not-Decoration** — saturated colour is earned by meaning. Not carrying a status or
  marking action/selection ⇒ it is gray.
- **Colour-Plus-Shape** — status is *never* colour alone. Every pill pairs hue with a text label;
  SP Matrix's A/S/L badges are filled/hollow as well as coloured.
- **Coral-Is-A-Fill** — reach for indigo when the accent must be text.

---

## 1. Roadmap Creator

**Source:** [src/apps/roadmap/](src/apps/roadmap/) · root [RoadmapApp.jsx](src/apps/roadmap/RoadmapApp.jsx) ·
[server/apps/roadmap/](server/apps/roadmap/) · schema [schema.sql](server/apps/roadmap/schema.sql)

Pivot the product catalogue into a category roadmap, mark what's being replaced or retired, plan
the gaps, and present it — with the economics hidden — to a supplier in the room.

Origin: a single-file HTML prototype ([docs/Roadmap Creator v04.html](docs/Roadmap%20Creator%20v04.html))
that kept every annotation in one `localStorage` blob. The port moved **both halves into SQL**, which
is the whole point of the module.

### 1.1 Features

**Reference data — refreshed by upload**
- Upload a `ProductFactoryPrices_Analysis` `.xlsx`. Parsed **entirely in the browser**, matched by
  header **text** on the `Working Tab` sheet (never by position), so an inserted upstream column
  doesn't break the parser.
- Two-step: **parse → preview counts → commit**. A wrong file or renamed column is caught before
  anything reaches the shared database, and the person committing sees the row/category counts they
  are about to commit for everyone.
- 24 required headers; a missing one fails **loudly** rather than producing a board of blanks.
  ([config/constants.js](src/apps/roadmap/config/constants.js))

**Annotations — the actual work**
- Per-SKU marks: **Replace / EOL / Already EOL / Upcoming**, each with a comment. Marking *Replace*
  offers the comment prompt in the same gesture, because a reason is nearly always wanted there.
- **Placeholder cards** ("New item" / "Upcoming item") dropped into any empty grid cell — a
  planner's "something belongs here" for a product that doesn't exist yet.
- **Hand-added families, rows and columns** for something the export doesn't carry yet.
- Every edit written to the shared DB as it's made, attributed to the sidebar's actor name.

**Views (4 tabs)**
1. **SKU Roadmap** — the pivot grid.
2. **Step-Up Chart** — the price ladder.
3. **History** — the append-only audit log + the **orphan report**.
4. **Summary** — three review tables (New Projects / Replacements / EOL) with approval workflow.

**Summary tab specifics**
- Status dropdown (`To be Reviewed` / `Approved` / `Rejected`) **and** approver dropdown, kept
  independent — picking one never resets the other, so "who's reviewing it" can be set before or
  after the decision.
- Approvers are a hardcoded pair, mirrored server-side for validation.
- **Project Code** field, and a **Jira** column that auto-checks whether an Epic with that code
  exists — re-checked whenever the code changes, no button for the common case, manual retry on error.
- **Expected 2027 NIC** — a manual revenue estimate for a not-yet-existing SKU, summed once Approved.

**Presentation mode ("Hide metrics")**
- One toggle strips *everything commercial* — ASP, factory price, SM%, the NOV table, the YoY badge,
  the chart's tick values, lane averages and price band — while keeping everything that
  **identifies** the product and everything the roadmap is **about** (marks, comments).
- The ladder keeps its **shape** and loses its **numbers**: cards stay where the price scale put
  them, so "this sits above that" still reads.
- Persisted to `localStorage`, so a reload mid-meeting doesn't put the economics back on the projector.
- Deliberately always enabled and never disabled: the moment it's needed is the moment a supplier
  walks in.

**Exports**
- **PDF** of the board or the chart (html2canvas + jsPDF). An `is-exporting` class paints first —
  hiding the ⋮ buttons and unsticking headers — before the DOM snapshot.
- **Plain-text change summary**, previewed in a panel then downloaded.
- Both scoped to a single category.

### 1.2 How it's built

**Data model — two halves that must never damage each other** ([schema.sql](server/apps/roadmap/schema.sql))

```
REFERENCE (written only by an import)      ANNOTATIONS (written only by a person)
  roadmap_import      one row per upload     roadmap_item_flag   per-SKU mark + comment + status
  roadmap_sku         one row per SKU        roadmap_placer      one placeholder in one cell
  roadmap_sku_stage   bulk-load staging      roadmap_axis_value  hand-added family/row/column
                                             roadmap_audit       append-only, every change + import
```

> **The load-bearing guarantee.** `importSkus()` names *only* `roadmap_sku` columns, and its `MERGE`
> deliberately has **no `WHEN NOT MATCHED BY SOURCE` clause**. A refreshed export can insert and
> update reference rows but can *never* delete one, and never touches an annotation table at all. A
> SKU that drops out of a newer export is marked `is_current = 0` and still renders, dimmed, so the
> EOL note somebody wrote against it is not silently lost. If it reappears it flips back to `1` with
> its flag and comment still attached.

**The 7 axis attributes** (Main Color, Segment 01–05, IoT) are stored as one `attrs_json` object, not
7 columns — they're never queried on their own; every pivot happens client-side. Adding an 8th axis
is a constants edit, **no DDL**.

**`lib/grid.js` — the union rule** ([grid.js](src/apps/roadmap/lib/grid.js))

An annotation is addressed by *value* (family name, axis value), not by id. A refreshed export can
rename a family or remove the last SKU that gave a row its existence — and a placer pinned there
would have nowhere to render: the row survives in the DB but vanishes from screen, which is exactly
the data loss this app was built to prevent. So the axis lists are a **union of three sources**:

1. values present on the category's SKUs,
2. values added by hand,
3. **values referenced by an existing placer** ← the prototype didn't do this.

(3) guarantees every stored annotation has a cell to live in. The History tab's **orphan report** is
the other half: it names the annotations that only (3) is keeping visible.

**`lib/chart.js`** — pure layout maths. Cards centred on their price; when two would collide
horizontally the later drops a level rather than overlapping. One shared price scale across all lanes
so lanes are comparable at a glance. `CARD_H` vs `CARD_H_COMPACT` (208 → 140px) because a
presentation-mode card is ~70px shorter and lane stacking is absolute-positioned off those numbers.

**Endpoints** (`/apps/roadmap`, [routes.js](server/apps/roadmap/routes.js))

```
GET    /categories                 GET  /orphans?category=
GET    /board?category= | ?all=    POST /import              ← write barrier starts above this
GET    /imports                    PUT  /flags/:sku          DELETE /flags/:sku
GET    /audit                      PATCH /flags/:sku/status
GET    /jira/epic?code=            POST /placers  PATCH /placers/:id  DELETE /placers/:id
                                   POST /axis-values  DELETE /axis-values/:id
                                   POST /clear
```

`json({ limit: "20mb" })` — one refreshed export is ~2,500 rows / ~2MB once the browser has reduced
it to the ~30 fields kept.

### 1.3 UI / UX in full

```
┌───────────────────────────────────────────────────────────────────────────────────────┐
│  Roadmap Creator                                                                      │  h1, BwKlarstein
│  Pivot the product catalogue into a category roadmap, mark what's being replaced…     │
├───────────────────────────────────────────────────────────────────────────────────────┤
│ Category (System Index) [Ceiling Fans ▾] Supplier[▾] Y axis[Main Color▾] X[Segment01▾]│  TOOLBAR
│ Jump to SKU[____]                    👁 Hide metrics │+Family│+row│+column│🗑Clear     │  (context-sensitive
│                                       📄Summary │ ⬇Export PDF │ ⬆Refresh data         │   per tab)
├───────────────────────────────────────────────────────────────────────────────────────┤
│ [SKU Roadmap] Step-Up Chart  History (3)  Summary      · 2,510 SKUs · 4 not in latest │  TABS + live meta
├───────────────────────────────────────────────────────────────────────────────────────┤
│         │◄──── FAMILY: Vinoline ────►│◄──── FAMILY: Skyfall ────►│  PLANNED ✕        │  family band headers
│         │ Entry │ Mid │ Premium      │ Entry │ Mid │ Premium     │                    │  x-axis, per band
│─────────┼───────┼─────┼──────────────┼───────┼─────┼─────────────┼────────────────────│
│ White   │ ┌───┐ │     │ ┌───┐        │ ┌───┐ │     │             │                    │
│         │ │IMG│ │     │ │IMG│ ▲12%   │ │IMG│ │     │  ┌ ─ ─ ─┐   │                    │
│         │ │…  │ │     │ │…  │        │ │…  │ │     │  │NEW   │   │  ← placeholder     │
│         │ └───┘ │     │ └───┘        │ └───┘ │     │  │ITEM ✕│   │                    │
│         │ +flag │+flag│ +flag        │ +flag │+flag│  └ ─ ─ ─┘   │                    │
│ Black ✕ │  …    │ …   │  …           │  …    │  …  │   …         │  ← hand-added row  │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

**Layout.** One CSS grid whose columns are `(row label 130px) + one block of X-axis columns per
family band`, each cell 138px. Sticky row labels and header rows. Everything is presentational —
`lib/grid.js` has already decided which rows, columns and families exist.

**The SKU card** ([SkuCard.jsx](src/apps/roadmap/components/SkuCard.jsx)) — identical on the board
and the ladder; `variant` only changes image height:

- ⋮ menu button (top-right) — marks, comment, clear
- **YoY badge** — `▲12%` / `▼8%`, tone-coloured, hidden in presentation mode
- Cloudinary hero image with `loading="lazy"` + `crossOrigin="anonymous"` (needed for html2canvas);
  a failed load hides itself rather than collapsing the card
- Item number, description
- `2026 Net ASP` / `FP` / `Supplier` / `SM% 26` key-value rows (SM% tone-coded)
- A 3-column NOV table: `2025 | 2026 FC | 2026 YTD`
- `💬 comment` footer when one exists
- `not in latest file` tag + dimmed styling when `isCurrent === false`
- A full-width **overlay band** — `REPLACE` / `EOL` / `ALREADY EOL` / `UPCOMING ITEM`

**Board status hues are a separate vocabulary from the action colour.** *Replace* uses **indigo**,
not coral, so "this is selected" can never read as "this is a Replace SKU".

| Mark | Tint |
|---|---|
| New | `rgba(77,162,93,.14)` / line `#4da25d` |
| Replace | `rgba(96,98,246,.18)` / indigo |
| EOL / Already EOL / Upcoming | own tints, each with a text label |

**Placeholder card** — dashed outline, title (`NEW ITEM` / `UPCOMING ITEM`), `💬` note or
`+ add comment`, the author's name, and its own ✕. Stacks alongside real cards in a cell.

**Interactions**
- Click a card → **detail panel** (side drawer). Tick more cards → side-by-side comparison.
- Click ⋮ → **anchored action menu** with checkable marks, a separator, comment, and clear.
- `+ flag item` button in every cell → placeholder-type menu.
- **Jump to SKU** — type ≥3 chars, the matching card scrolls into view (`behavior: smooth`,
  `block: center`) and gets an `is-jump` highlight for 3.5s. Works on both the board and the ladder
  (different id prefixes).
- Hand-added rows/columns/families carry a `PLANNED` tag and a remove ✕; data-derived ones don't.
- Supplier filter is a **view filter, never a data filter** — marks, placeholders and *Clear marks*
  keep working against the whole category, so narrowing the board can't quietly narrow what an edit
  applies to. And it's **derived, not reset**: a supplier picked in one category falls back to "all"
  in a category that's never heard of it, and comes back when you return.

**Step-Up Chart** — lanes stacked vertically, each with a 168px label block showing lane name,
`n SKUs`, avg price, avg SM% (tone-coded) and the min–max band. Cards absolutely positioned on a
shared horizontal price axis; a bottom axis with nice ticks and an arrow-suffixed title. Filter chips
above (family / supplier / segment value / description contains), conjunctive with the toolbar's
supplier filter.

**Honesty notes, everywhere.** `"12 SKUs in this category hidden — no 'Main Color' or 'Segment 01'
value"`, `"4 SKUs hidden — no 2026 Net ASP value"`, `"Showing Supplier X only — 34 of 210 SKUs"`.
Nothing is dropped silently.

**Error handling.** The backend sits behind an intermittent VPN, so both error banners get a
**Retry** as well as a Dismiss — without one the only way back is a full page reload, which throws
away the rest of the screen state for a connection that has usually already recovered.

**"All categories" mode.** A sentinel category value. History and Summary read flat lists and work
across everything; the Roadmap and Chart are single-category pivots and show a "pick one category"
notice instead of pretending.

### 1.4 Dependencies

| Dependency | Used for | Required? |
|---|---|---|
| **SQL Server / Azure SQL** | everything | **Yes** |
| **`.xlsx` upload** (`xlsx`) | all reference data | **Yes** — this *is* the data source |
| Cloudinary URL convention | card thumbnails | No — the URL comes from the export's `Product Image` column |
| `html2canvas` + `jspdf` | PDF export | Optional |
| `recharts` | *not used here* — the ladder is hand-laid-out | — |
| **Jira** (`shared/connectors/jira.js`) | Summary tab's Epic existence check | Optional — degrades to "Jira not configured" |
| **Attribute Viewer `/compare`** | the detail panel's collapsed "Akeneo attributes" section | **Optional, lazy, click-to-load** |
| **Akeneo** | *nothing directly* | **No** |

**The only Akeneo touch** is [AttributeComparePanel.jsx](src/apps/roadmap/components/AttributeComparePanel.jsx),
and it is already built as if it might not be there:

- Nothing fetched until asked for — expanding the section shows a **button**, not a spinner.
- Adding a SKU marks the loaded result **stale** and says so, rather than silently re-reading.
- Default view is **differences only**; agreements are behind "Show all".
- One SKU has nothing to differ *from*, so it's forced to "all" rather than showing an empty list
  under a misleading caption.

### 1.5 OriginFlow port

**Effort: ~1 day.** Roadmap is already Akeneo-free.

1. Copy `src/apps/roadmap/` + `server/apps/roadmap/` verbatim.
2. Run `schema.sql` on OriginFlow's database. Keep **both halves and the `MERGE` guarantee** — the
   no-`WHEN NOT MATCHED BY SOURCE` rule is the single most valuable line in the module.
3. **`AttributeComparePanel`:** either delete it, or repoint `getSkuAttributes()` at OriginFlow's own
   attribute store (§4.4 makes this a *local* read rather than a live PIM read, which removes the
   panel's entire reason for being lazy — but keep it lazy anyway; it costs nothing).
4. **Jira:** keep if OriginFlow has credentials; it already degrades gracefully.
5. **Thumbnails:** the image URL comes from the spreadsheet, so nothing to change. If OriginFlow has
   its own asset store, swap the `image_url` mapping in
   [server/apps/roadmap/mapping.js](server/apps/roadmap/mapping.js).
6. **Actor:** wire OriginFlow's user identity into the `actor` field. Every write already carries it.

---

## 2. SP Matrix

**Source:** [src/apps/sp-matrix/](src/apps/sp-matrix/) · root [SpMatrixApp.jsx](src/apps/sp-matrix/SpMatrixApp.jsx) ·
[server/apps/sp-matrix/](server/apps/sp-matrix/) · **rules** [ecodesign.js](server/apps/sp-matrix/ecodesign.js) ·
schema [schema.sql](server/apps/sp-matrix/schema.sql)

Spare-part coverage per main item: which parts are linked, whether each exists in the PIM and is live
on the webshop, and which ECO-design parts are missing.

### 2.1 The idea that makes it worth building

**Gaps are split two ways, and the split is the whole point.**

- **`basis: "regulatory"`** — a real EU Ecodesign spare-part availability duty. Missing one is a
  compliance exposure. A `legalRef` names the instrument so the claim can be *checked* rather than
  trusted (`Commission Regulation (EU) 2019/2019, Annex II, point 3(a)`).
- **`basis: "policy"`** — a Klarstein working standard for categories the regulations don't oblige
  (hoods, ACs, space heaters, garden structures). Worth chasing; **never a legal breach**.

> Encoding a policy gap as regulatory would be the expensive mistake: it turns an internal to-do list
> into a false compliance alarm. The UI must never colour them alike.

**And parts are split two ways too, by *how they can be available*:**

- **`tier: "consumer"`** — self-fit (hinges, gaskets, shelves, filters). Gets a Klarstein SKU, a PIM
  record and a shop page. *Covered = a spare part is linked.*
- **`tier: "professional"`** — technician-fit (thermostats, sensors, PCBs, LEDs, motors, pumps).
  Supplied through **ASWO**, never listed in the shop. *Covered = confirmed available at ASWO, **or**
  a SKU exists anyway.* Excluded from the PIM comparison, which would otherwise report a gap for a
  part nobody expects there.

Either route counts as coverage: the regulation asks for a part to be **obtainable**, not for it to
come down one particular channel.

### 2.2 Features

**Two views**
1. **Coverage** — item-first. One row per active main item: what it needs, what's linked, what's
   missing.
2. **Spare parts** — part-first. A register of all ~2,400 parts showing which are missing from the
   PIM, not listed, out of stock, or still without a supplier article number. Inline editing of the
   two fields we author (supplier part no. + note); everything else is mirrored and is fixed
   upstream.

**Coverage view**
- **Consumer slots** — every expected consumer type renders as a chip whether or not it's linked, so
  the column shows what the category **owes** as well as what it has. Four states, each visually
  distinct: `linked` (a real part chip), `missing` (dashed outline), `in_progress` (amber),
  `not_required` (grey + tick). *A part somebody decided against must never look like a part that
  exists.*
- **Professional chips** — **five** states, and the fifth matters: `available` (At ASWO),
  `not_available` (**checked and NOT there** — a finding), `in_progress`, `not_applicable`,
  `unchecked` (**nobody has looked** — a to-do). Merging the last two would either invent compliance
  problems or hide real ones.
- **ASWO checklist** per item — availability tri-state, supplier article number, link to the ASWO page.
- **Accessories** — free-form, hand-linked, no taxonomy, no expectation, **no effect on any coverage
  number**. An accessory is not a spare part.
- **Coverage bar** — coloured by **basis**, not ratio: a half-covered regulated item and a
  half-covered policy item are the same number and very different problems.
- **Waivers** (`not_required`) count as covered — the obligation has been judged not to apply. It's a
  real decision, so it's audited and rendered as its own state, never as a part that exists.
- **In progress is NOT covered.** The part doesn't exist yet; somebody is working on it. Surfaced
  separately so an in-flight gap isn't chased as though nobody had looked.

**Type manager** — the spare-part type list is code + sparse DB overrides. Add a type, correct a
label, move one between the User and Pro tiers, reorder, retire. Retired types stay resolvable: a
link recorded against one must still render with its label rather than as a bare code.

**Refresh data** — one deliberate action that brings every upstream data point current
(`PL_V_Item`, the Akeneo family view, the shop feed, the PIM's own links). Nothing else on the page
waits on the warehouse.

**Filtering, twice over, composably**
- **Filter bar** asks questions no single column can: "regulated with no parts at all", scope
  (all / critical / regulated), missing-type, shop state, sort-by-severity.
- **Column headers** sort and filter whatever the bar returns — text, enum, or a *derived* accessor
  (coverage is a ratio; the PIM column is a verdict over two directions of divergence).

**CSV export** of the filtered view. **Append-only history** panel.

### 2.3 How it's built

**`ecodesign.js` — one file to edit when compliance changes.** Pure data + pure functions, so every
rule is unit-testable and nothing is buried in a query or a component. Three parts:

1. **Taxonomy.** The source matrix typed parts as free text: 1,220 rows of hand entry produced **88
   distinct spellings for ~36 real things** (`Hinge`, `Hinges`, `hinge`, `Hnge`, `Door Hinge`,
   `Upper Hinge` are one type). `normalizeSpType()` collapses them so "does this fridge have a hinge
   part?" is answerable at all.
2. **`REGIMES`** — 3 regulatory + 7 policy. Each names its categories, its `required` types (exactly
   the list in the instrument) and its `policyExtras` (things the category ships that the regulation
   doesn't name). Category names are listed **as the warehouse spells them, typos included**
   (`Elelctric Radiators`, `Ceilling Hoods`) *plus* the correct spelling, so fixing the data upstream
   doesn't silently drop a category out of scope.
3. **`evaluateItem()`** — the verdict. Returns `severity`
   (`critical | regulatory-gap | policy-gap | ok | unscoped`), the two gap lists separately,
   `hasNoParts`, and the consumer/professional halves of the expectation.

> Two gap sizes are reported separately on purpose. *"This regulated fridge has no spare parts at
> all"* and *"this regulated fridge has eight of nine required types"* are different sizes of
> problem, and a single is-it-compliant boolean would flatten them into one.

One comment in `REGIMES` is worth reading as a template for this kind of tool: the bare "Wine
Coolers" L2 bucket is *deliberately excluded*. Its 153 members look like a missing regulated category
but are **spare parts mis-typed in SAP as ZTRG** — their descriptions are `Shelve-S1`,
`Door Hinge-D22`, `Gasket-G31`. Adding it would flag 153 spare parts as appliances failing to stock
their own spare parts, which is exactly the false alarm the regulatory tier exists to prevent.

**Data model — what lives here and what deliberately doesn't** ([schema.sql](server/apps/sp-matrix/schema.sql))

The warehouse already owns every *fact* about an item. **None of it is copied.** Duplicating it would
create a second, staler truth someone would eventually have to reconcile. What the warehouse does
*not* own is the main-item ↔ spare-part **relationship** — that lived only in the team's spreadsheet,
and `PL_V_ITEM_BOM` doesn't carry it (its `ItemElement` values are a different number space and its
rows stop in 2019).

```
sp_matrix_link          (main_sku, sp_sku, sp_type, raw_type, source, note)  ← THE ONLY COPY
sp_matrix_item          per-item workflow status (needs_sp, aswo_status, user_status, comment)
sp_matrix_professional  per (item, pro type): availability tri-state, supplier art. no., ASWO link
sp_matrix_slot          per (item, consumer type): missing | in_progress | not_required + note
sp_matrix_accessory     free-form accessory links
sp_matrix_part          the fields we author on a part (supplier part no., note, proposed title)
sp_matrix_type          sparse overrides on the built-in type registry
sp_matrix_audit         append-only
```

> **Nothing imports `sp_matrix_link`.** The spreadsheet was a one-time origin; the seed module, its
> bundled JSON export and the bulk-import endpoint have all been *removed*. Every change is a single
> audited row through the API — so "a re-import cannot revert a correction" is not a property to
> defend, it's a consequence of there being no re-import.

`raw_type` is kept beside `sp_type` so a mis-normalised value can be traced back to what a human
actually typed, rather than being lost in the mapping. `source` records **who last set the row's
values**, not who created it — creation provenance lives in the audit log.

**Endpoints** (`/apps/sp-matrix`)

```
GET  /overview  /matrix?l1=&category=  /stats  /rules  /types
GET  /parts-register  /parts?q=  /parts/:sku  /audit
─────── write barrier: requirePermission("sp-matrix","editor",{soleGuard:true}) ───────
POST /links   PATCH /links/:id   DELETE /links/:id
PUT  /items/:sku/status     PUT /items/:sku/professional/:type    PUT /items/:sku/slot/:type
PUT  /parts/:sku
POST /accessories   DELETE /accessories/:id
POST /types   PATCH /types/:code   DELETE /types/:code
```

**Loading is per category.** The overview (L1/L3 tree + global summary) is a cheap local read on
mount; the matrix loads only once a category is chosen, keyed on the selection so switching cancels
the previous request rather than letting a slow one land after a fast one and show the wrong category.

**Rendering budget.** The filtered set can be 3,251 rows and each row can carry 15 chips. Rows are
revealed in pages of 60 via an `IntersectionObserver` sentinel (`rootMargin: 400px`) plus a
*Show more* button. A plain `.map()` over everything would mount ~30,000 chip elements and make
typing in the search box feel broken. The reveal window resets **during render** (React's
"adjust state when a prop changes" pattern) so the first paint after a filter change already shows
page 1 — an effect would paint the old, longer list first.

### 2.4 UI / UX in full

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ SP Matrix                                    🔒 Edit  🕐History  🏷Types  ⬇CSV  ⟳Refresh│
│ Spare-part coverage for every active main item — what is linked, whether it is in      │
│ Akeneo and live in the shop, and what ECO-design requires that is missing.             │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ┌─────────┐┌─────────┐┌────────┐┌────────┐┌────────┐┌────────┐   ← clickable filter tiles│
│ │🛡Regul. ││Regulat. ││Policy  ││Linked  ││In shop ││PIM     │     ordered by what to    │
│ │no parts ││gaps     ││gaps    ││        ││        ││divergs ││    act on first          │
│ │  401    ││  1,204  ││  312   ││ 1,162  ││ 1,133  ││  87    │                          │
│ │12 at ASWO│of 401 reg│no duty ││        ││        ││        │                          │
│ └─────────┘└─────────┘└────────┘└────────┘└────────┘└────────┘                          │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ ℹ Regulatory gaps are EU Ecodesign duties (2019/2019, 2019/2022, 2019/2023). Policy    │  LEGEND
│   gaps are Klarstein standards…    Ⓐ in Akeneo · Ⓢ live in webshop · Ⓛ linked in PIM  │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Data sources: PL_V_Item 2h ago · Akeneo family 2h · shop feed 2h · PIM links 2h   ⟳    │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ [▦ Coverage · what each appliance needs]  [🔧 Spare parts · the state of each part]     │  TABS
├────────────────────────────────────────────────────────────────────────────────────────┤
│ L1 [Kitchen ▾]  L3 [Fridges with Freezers ▾]        Scope[all▾] 🔍[____] Missing[▾]     │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ Main item ⇅▾│Category⇅▾│Supplier⇅▾│ECO ⇅▾  │Covered⇅│User Spare Parts │Prof. SP│Access.│
│ ┌──┐10035221│Fridges w/│ SUP-0142 │[Regul. │▓▓▓▓░░░ │(Hinge)(Gasket)  │✓Thermo │(Cool  │
│ │▣ │Klarstein│ Freezers │ gap]    │  6/9   │(Shelf)  ⌐Basket⌐│✓Sensor │ Pack ✕│
│ │  │Vinoline │          │         │        │ ⏱Handle  ✓Foot  │−PCB    │  + Add │
│ └──┘         │          │         │        │  + …            │✕LED    │        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

**The part chip** ([PartChip.jsx](src/apps/sp-matrix/components/PartChip.jsx)) answers three checks
at a glance, without a click:

| Badge | Meaning |
|---|---|
| **Ⓐ** | the part exists in the PIM |
| **Ⓢ** | it is live in the webshop |
| **Ⓛ** | the PIM agrees it belongs to *this* main item (`substitution` association) |

Filled vs hollow **as well as** coloured — this table is scanned in bulk, and colour-blind-safe state
is worth more here than prettiness. A **hollow Ⓛ** means the matrix claims a link the PIM doesn't
have; a **dash** means associations weren't fetched, which is not the same thing and must not read as
a failure.

The chip shows the part's **name** (from the item master), never its type — the type is already the
identity of the slot the chip sits in, and showing it as the name made every hinge in the catalogue
read alike, so you couldn't tell `SP - Hinge Happy Hour` from `SP - Hinge Vinoline` without opening
each one. A **pending proposed title** wins over the warehouse name while it's outstanding.

The shop button **always resolves somewhere**, and the two kinds are drawn differently: an **arrow**
for a real product page from the feed, a **magnifier** for a shop search on the part number. *A link
that merely searches must never read as evidence the part is listed.* (Only 1,133 of 1,159 linked
parts have a real page.)

Tooltips are dense and honest — name, EAN or "no EAN in the item master", supplier part no.,
type + `(read off the part's name — no type was set)` + the sheet's original spelling, proposed
rename, PIM presence, PIM-link state, stock note, `Shared by 3 main items`,
`Item type ZTRG — not classified as a spare part in SAP`.

**Chip menus.** Every slot and pro chip opens a small anchored menu with shared
outside-click/Escape handling — *a menu that survives a click elsewhere ends up floating over an
unrelated row, which is how you edit the wrong appliance.* Each menu heads with the part label and
`required by law` / `company standard`, then offers the three routes out of "missing":

| Slot state | Menu (in order) |
|---|---|
| `missing` | **Link an existing part…** · Mark as in progress · Mark as not required |
| `in_progress` | Link an existing part… · Mark as not required · Back to still needed |
| `not_required` | Link an existing part… · Mark as in progress · Back to still needed |

"Link" is always first — linking is the outcome the other two are only waypoints towards. It hands
off to the **link editor** (which asks for the password itself, so it stays enabled while locked);
the status writes go immediately and **are** disabled until unlocked.

**Dialogs / panels:** Link editor · Part detail panel (a chip identifies a *part*, so a chip click
opens the part, not the link editor for whichever appliance happens to be on screen) · ASWO checklist
· Accessory picker · Type manager · History.

**Colour discipline.** Regulatory `#ea1903` @ 10% · Policy `#b45309` @ 12% · Covered `#4da25d` @ 10%
· out-of-scope grey. Coral is action/selection **as a fill only**; indigo carries the accent as text.

### 2.5 Dependencies

| Dependency | Used for | Required? |
|---|---|---|
| **SQL Server / Azure SQL** | links, slots, pro, parts, types, audit | **Yes** |
| **Shared product cache** (`dbo.product_item`) | every product fact | **Yes** |
| **Warehouse `PL.PL_V_ITEM`** | item master, categories, EOL, supplier | **Yes** — via the cache refresh |
| **Warehouse `L0.L0_AKENEO_ITEM_FAMILY`** | the **Ⓐ** flag | **Yes** — but this is a *warehouse view*, not the PIM API |
| **Warehouse `L0.L0_SHOP_FEED_MASTER`** | the **Ⓢ** flag + shop URL, stock, price | **Yes** |
| Cloudinary URL convention | row + chip thumbnails | Optional, zero-cost (derived from item no.) |
| **Akeneo REST (`substitution` associations)** | the **Ⓛ** flag only | **No** — already optional |
| ASWO | an external URL a person pastes | No integration |

**Nothing on the page queries the warehouse.** It used to, and the same Synapse scan measured 0.9s to
26s depending on load — which showed up as `"Failed to cancel request in 5000ms"` rather than as a
slow page.

### 2.6 OriginFlow port

**Effort: ~2–3 days.** One field to decide about.

1. Copy both halves + `ecodesign.js` verbatim. **Do not restructure the rules file** — the two-tier
   basis model and the typo-tolerant category lists are hard-won.
2. Port the **shared product cache** (§0.3). This is the real prerequisite and it's shared with
   Attribute Viewer, so do it once.
3. **The Ⓛ flag — three options:**
   - **Drop it.** `link.inAkeneo === null` already renders as a dash meaning "not checked", and the
     UI is explicit that a dash is *not* a failure. `meta.hasAssociations` already gates the whole
     column. Zero code change: just don't configure `AKENEO_API_URL`, and the refresh logs
     `"Akeneo not configured — spare-part associations skipped"`.
   - **Re-source it from OriginFlow.** If OriginFlow holds its own main-item ↔ spare-part
     relationships, point `getAkeneoAssociations()` at them and rename the flag. The comparison logic
     ("associations pointing at ordinary products are counted as replacements, not spare parts")
     transfers directly.
   - **Re-source it from the warehouse.** If a view can express the association, this is the cheapest
     honest answer.
4. **The Ⓐ flag needs no change** — it's `L0_AKENEO_ITEM_FAMILY`, a warehouse table. If OriginFlow
   becomes the system of record, rename the flag to *"in OriginFlow"* and source it from
   OriginFlow's own product table; the semantics ("does the content system know this SKU") are
   identical.
5. Keep the **edit password** and the **positional write barrier**.
6. Keep `sp_matrix_link` as the only copy. **Do not add an import endpoint.**

---

## 3. Attribute Viewer

**Source:** [src/apps/attribute-viewer/](src/apps/attribute-viewer/) · root
[AttributeViewerApp.jsx](src/apps/attribute-viewer/AttributeViewerApp.jsx) (1,634 lines) ·
[server/apps/attribute-viewer/](server/apps/attribute-viewer/) · schema
[schema.sql](server/apps/attribute-viewer/schema.sql) · grid logic
[lib/grid.js](src/apps/attribute-viewer/lib/grid.js) · Akeneo layer
[akeneo.js](server/apps/attribute-viewer/akeneo.js)

For one L3 category: **every** SKU in it, **every** attribute that category's definition names, and
each value — from the PIM where the PIM has one, from a person where somebody has filled a gap or
corrected it.

This is the largest and most opinionated of the three, and the one that actually needs redesign for
a self-sustaining OriginFlow. §3.6 is the port plan.

### 3.1 The three pieces, and why each comes from where it does

| Piece | Source | Why |
|---|---|---|
| **The SKUs** | shared product cache | Not the warehouse: the same scan measures 0.9s–26s, which on a page load is a timeout, not a slow page. Refresh is a button. |
| **The attributes** | a per-category **definition** in SQL | Nothing hardcodes what a category's attributes are. Uploaded as the team's CSV, or authored in the built-in editor. |
| **The values** | **LIVE from Akeneo**, batched | Live on purpose: this module exists to *compare against the PIM*, and a cached PIM would make every divergence "as of some earlier time". |

**Two invariants that everything else hangs off:**

> **An edit never loses to Akeneo.** Reading the PIM updates only the *comparison* (does this still
> differ, and what did Akeneo hold when we looked) — never the stored value. So work in progress is
> safe, and "everything still to push" is a local query across every category instead of a fan-out of
> live PIM calls.

> **The SKU list deliberately includes every non-discontinued item the warehouse has** — not just
> `ItemStatusMI = 0` but also items with no item-master status, and items missing from the PIM
> entirely, each flagged as such. *A SKU that is hidden is a gap that cannot be found, which is the
> whole point of the module.* On Angled Hoods that's 143 products rather than 115.

### 3.2 Features

**The grid**
- **One row per attribute, one column per SKU** — a spec-comparison sheet. Attribute rows banded
  into collapsible cluster sections in the definition's own order.
- Each SKU column header carries a **thumbnail** (a deterministic Cloudinary URL, so 115 of them cost
  **zero API calls**), item number, description, a **klarstein.de link** (real feed URL where listed,
  shop search where not — kept visually distinct), a **review status** chip and per-SKU counts.
- Each attribute row shows its **coverage across the category** (`87/115` filled).
- **Clicking an attribute row orders the SKU columns by that attribute** — ascending, descending,
  off. Type-aware, so a metric sorts on its number; blanks always last in both directions.
- **Ticking SKU headers** builds a side-by-side comparison of just those products.
- Sticky attribute column *and* sticky SKU header row — a value is meaningless without both of its
  coordinates, and at this size you're always scrolled away from at least one.

**Cell states — six, and none rely on colour alone**

| State | Colour | Meaning |
|---|---|---|
| `diverging` | amber `#b45309` | a local value contradicts the PIM |
| `added` | blue `#1d4ed8` | a local value where the PIM has none |
| `cleared` | rose `#ea1903` | a request to empty a field the PIM still fills |
| `synced` | green `#4da25d` | the PIM has caught up; nothing to do |
| `akeneo` | plain | simply what the PIM says |
| `empty` | grey | nothing anywhere |
| *invalid* | **solid red fill** | not an option of its attribute — the export refuses this product |
| *EPREL* | violet `#7c3aed` | a different question, so a colour nothing else has spoken for |

A pending cell also carries a corner flag, and every state is named in the legend, the tooltip and the
SKU panel.

**Editing, two ways**
- **In the grid**, like a spreadsheet: click selects · double-click (or `Enter`/`F2`) edits in place ·
  `Enter` saves and moves **down** to the next attribute for the same product · `Tab`/`Shift+Tab`
  moves to the next/previous **SKU**, same attribute · `Esc` abandons · arrows navigate ·
  `Shift+Enter` opens the whole SKU in the side panel.
- **In the side panel** (click a SKU number): all of that SKU's attributes grouped by cluster — the
  better surface for filling one in from empty (70 fields, one at a time).

**Units are shown, not typed.** Akeneo returns a metric as one string
(`671.0000 CUBIC_METER_PER_HOUR`); the grid puts the **number** in the cell and the **unit above it**
in small grey type, so what you edit is the value alone. The unit belongs to the stored value and
travels with it into the export.

**Review status.** Each SKU is **In progress** or **Final**. Once Final, changing any value warns
first *and the server refuses the write unless the change is explicitly acknowledged* — so the
sign-off is not just a dialog. A reopen dialog demands a reason, and that reason shows on the column
header where a reader asks "why is this still open?".

**Bulk work.** Tick SKU headers, then set one attribute across all of them, or **copy a reference
SKU's** values onto them by cluster. Both default to filling only **empty** cells — judged against
what the cell actually *shows*, including values that live only in the PIM — and both report per SKU
what was set, skipped as already-filled, or skipped as signed-off.

**Filters.** Every filter lives in one **collapsible side panel**; collapsed, it becomes a rail
showing how many filters are on, *so a hidden panel can never conceal that it is filtering*. Ten row
filters (`pending`, `edited`, `required-gap`, `incomplete`, `complete`, `eprel-differs`,
`not-in-akeneo`, `unmaintained`, `maintained`, `all`), cluster filters, per-attribute value filters
with a spelled-out `__no_value__` sentinel (a blank string can't do the job — it's indistinguishable
from "no option chosen" in a `<select>`).

**The definition editor** ([DefinitionEditor.jsx](src/apps/attribute-viewer/components/DefinitionEditor.jsx))
- A grid of the category's attributes: name, group/cluster, Akeneo code, type, enum options, unit,
  required, supplier-visible, order.
- **An attribute is not owned by a category.** "Product Height", "ISTA Level" and "Number of
  batteries" are the *same* attribute wherever they appear, so a **GLOBAL** attribute is one shared
  row many categories point at — editing it anywhere changes it everywhere. The badge says how many
  categories share it, promoting asks for confirmation, and the save reports back which globals it
  touched.
- Removing a row only **unlinks** the attribute from that category; it stays in the catalogue and its
  stored values are kept.
- **Nothing is written until Save** — one button, one transaction. Someone renames six attributes,
  retypes two and reorders the lot before they're done; a request per keystroke would leave the
  definition in states that never existed on screen, and a failure halfway would leave it in one of
  them permanently.
- **Order is the rendered order.** `sort_order` is simply the position in the flattened list; no
  second source of truth about position to drift.
- Each attribute carries a **comment** — what it is and what to watch for (*"Class I = earthed metal
  body; Class II = double insulated. Take it from the type plate, never from the manual"*) — shown on
  the grid's attribute row and in full in the SKU panel while the field is open. A comment on a global
  attribute is one comment everywhere.

**The Akeneo ID box searches as you type.** Typing a code from memory is how a definition ends up
pointing at nothing, or at the wrong one of `air_flow` / `air_volume_flow` / `air_flow_speed_boost`.
From two characters on, matches are listed with the PIM's own label, group, type and guideline text,
plus whether the catalogue already defines each one and whether *this* category already uses it.
Picking one fills the code, and the name and type only while they're still empty. **It assists rather
than gates** — a code can still be typed by hand, including one about to be created.

> Akeneo has no `contains` filter for attributes (`code` takes only IN/NOT IN), so the whole catalogue
> — 1,628 attributes, 17 pages — is read once and held for half an hour. A search per keystroke would
> be unusable, and an exact-code match wouldn't answer the question being asked.

**The option conversion matrix — "our words are not Akeneo's, so the mapping is explicit."**

A select is imported by option **CODE**, and the two vocabularies don't line up.

- Some pairs the tool **proves for itself**: our `A++` is the PIM's `Aplusplus` (its own label for
  that option is "A++"); `Type C <2.5A - 2 pin` is `type_c_2_5a_2pin` (same text, different dash).
  Case, separators and the plus codification are **notation, not meaning**.
- Others are judgements no rule can make: "Class I" is Akeneo's `I`, "Schuko Plug" is `plug_type_f`,
  "Knob" *might* be `mechanic`. Those are **PINNED** by a person.
- The matrix is shown **with the tool's own work**: which options resolved, and how — pinned, by
  label, by code, or inferred from notation — and which still need a decision.
- **Only what is pinned is fixed.** Everything else is worked out on every read, so an option renamed
  in the PIM keeps resolving instead of going stale behind a stored answer.
- **Inference never guesses between candidates.** `220_240V_50_60Hz` and `220_240Vs_50_60Hz` are two
  real, different options that normalise to the same text, so that pair is reported as **ambiguous**
  rather than picked. On Angled Hoods, 7 attributes have collisions like it.
- The matrix lives on the **attribute**, so mapping a global one once maps it everywhere.
- **Check definition judges options through exactly this matcher**, so what it reports and what the
  export blocks on are the same thing.

**The export is an Akeneo import file, or it is nothing.**
([akeneoExport.js](server/apps/attribute-viewer/akeneoExport.js))

Alongside a readable hand-off CSV, **To push** builds a file the PIM's product import accepts as-is:
one row per SKU, `;` separated, selects written as option **codes**, every metric carrying its own
`-unit` column. **Only the attributes that changed become columns** — a file listing all 71 would
blank the ones with no value in it.

Every value is checked against the live PIM first, and **one value the PIM would reject blocks the
whole export**: no file at all, only a list naming the SKU, the attribute and the remedy.

> *A partial file handed over with a list of warnings is one somebody imports anyway, landing half the
> work and silently dropping the rest.*

What blocks it: an attribute the PIM doesn't have · a select value reaching no option code (unmapped,
ambiguous, or pinned to an option since dropped) · a non-numeric value in a numeric field · a
localizable or scopable attribute needing different column headers · a metric whose unit can't be
determined · **a SKU the PIM doesn't have** · **a read that couldn't confirm the products exist**
("we could not check" is not "it is fine") · a MODEL-level attribute a variant product row would
silently drop.

That SKU check is not a rejected row but an **invented product**: Akeneo's import *creates* any
identifier it doesn't recognise, so an unknown SKU would silently add a family-less product rather
than fail — and this module *deliberately lists* SKUs missing from the PIM (6 of the 143 Angled Hoods
items).

**The unit check earns its keep the same way:** the unit is read from **the product's own current
value**, not the attribute default, because `Kabellaenge` holds some products in `CENTIMETER` and
others in `METER` — exporting both with one default would rescale half of them by a hundred, in a
file that imports without a single complaint.

**Two classes of false alarm are handled rather than displayed.** Akeneo answers selects with option
codes and reference entities with record codes (`silver`, `220_240Vs_50_60Hz`) while the definition
speaks in labels, and it answers metrics as `{amount, unit}` (`190.0000 WATT`) — both sides are
folded through the PIM's own option/record maps before comparison, so a correct value never reads as
diverging. Conversely, **real** definition problems *are* surfaced.

**Diagnostics**
- **Check definition** — validates a loaded definition against the live PIM *without* loading the
  category: attributes the PIM doesn't have, type disagreements, options it won't accept, family
  consistency + per-attribute family membership **including Akeneo family inheritance**, and
  model-level attributes that would be dropped.
- **Find what it populates** — samples a category's products to draft a definition from the
  attributes actually in use (not from the Akeneo family, which declares **636** where a curated
  definition holds **71**).
- **Variant groups** — how the category's products group into Akeneo variant families, and whether
  any would **collide** on an axis attribute.
- **Catalogue panel** — every attribute in the catalogue, what it means, which categories use it,
  edited once for all of them. Plus attribute **merge**.

**EPREL cross-check** ([eprel.js](server/apps/attribute-viewer/eprel.js))

For every attribute the definition maps to an EPREL field, the registry's own figure is shown under
the value in small type, and the cell is flagged when the two **genuinely** disagree — fetched in a
separate request **after** the grid renders, so a rate-limited or slow registry can never delay or
break the page.

"Genuinely" is the work: strip metric units (`641.0000 CUBIC_METER_PER_HOUR` = `641`), tolerate
precision at the coarser of the two (`0.44` = `0.4`), and fold class codifications both ways — the
spelled-out `a_plus_plus` and EPREL's own `AP`/`APP` shorthand all reduce to `A+`/`A++`. *That last
one alone was 81 false mismatches on one category.* A value EPREL has and the PIM doesn't is marked
**separately**, since it's fillable rather than wrong.

**Where they disagree, the edit starts from EPREL.** Double-clicking such a cell opens the editor
already holding the registry's figure, because "make the PIM say what EPREL says" is nearly always
the edit being made — **401 cells** on Angled Hoods. It's a starting point, not a decision: the editor
says the value came from EPREL, one click restores the old one, nothing is written until confirmed.
The figure is converted server-side into a form the field can hold (`APP` → the option labelled
`A++`; a measurement loses its unit), and **when there is no safe equivalent nothing is offered at
all** — a wrong pre-filled value is harder to notice than none. A cell with a **pending edit is never
re-seeded**: somebody typed that.

**Importers — three sources, one classifier**
1. **Spreadsheet importer** — compare a sheet of per-SKU values against the PIM and take the ones the
   sheet is right about. Three-stage: scan → preview → apply.
2. **From OriginFlow** — read back what suppliers captured (§3.5).
3. Both go through **one server-side classifier**, so the buckets and verdicts are identical.

**Product Changes log** — Akeneo's `product_changes` table attribute for every SKU. Rendered as its
own read-only band after every cluster, outside the keyboard grid; edited in the SKU panel. Carries a
**whole-table-per-cell rule** that makes a partial export destructive.

**History** — the append-only audit log: every value, status and definition change with
before → after, who and when, filterable and exportable.

**`GET /definitions` — the machine-facing sync endpoint.** Every category with a definition, each
carrying an `updatedAt` that moves for **any** change to that definition — *including an edit to a
shared attribute made from a different category*, which changes this one too and would otherwise let
two systems drift apart silently. `?include=attributes` embeds the full list; `?since=<ISO>` returns
only what changed, with `syncedAt` to pass back next time. **The cheap unfiltered call is the
authority on which categories exist** — `since` cannot report a deletion. Nothing caches a definition
anywhere in the module, so an edit is visible on the very next request.

### 3.3 How it's built

**Data model** ([schema.sql](server/apps/attribute-viewer/schema.sql))

```
attr_category            one row per L3 with a definition + when its live PIM values were last read
attr_attribute           THE ATTRIBUTE, once: name, code, field type, options, unit, EPREL id,
                         cluster, scope, supplier visibility. The single source of truth for
                         what an attribute IS.
attr_category_attribute  WHICH categories use it, in what order, and whether it's required there.
                         Order and required-ness are the ONLY per-category facts.
attr_value               THE ONLY COPY of a human's edit. One row per (SKU, attribute) someone has
                         typed into. The table that must never be lost.
attr_sku_status          per-SKU review status (in-progress / final) + reopen reason
attr_change_entry        the Product Changes log entries
attr_audit               append-only: every value edit and every definition upload
```

On `attr_value`, three columns are **derived** and refreshed on every category load:
`akeneo_snapshot` (what the PIM held when the two were last compared), `diverges` (that comparison's
answer, defaulting to `1` because a brand-new edit hasn't been compared and treating it as in-sync
would hide it), and `checked_at` (so the UI can say "as of 14:20" rather than implying live).

The value itself is stored as **text, verbatim**: the definition says how to read it, and a decimal
column would make `"1,5"` from a German keyboard either an error or a silent `15`. Validated against
the field type on the way in, then kept as typed. **`NULL` means explicitly CLEARED**, which is
different from there being no row at all (nobody has touched it).

`attr_value` is keyed on `(sku, akeneo_code)` — **not** including the category. An attribute belongs
to a SKU, and the same SKU must not end up with two different values for one attribute because it was
edited from two categories.

**`akeneo.js` — reading the PIM in bulk.** Two parameters do all the work, and leaving either off is
the difference between a usable page and a broken one:

- `attributes=<only the codes the definition names>` — without it, one page of 100 products weighs
  **~19MB** and takes ~4s. With it, a 70-attribute definition's page is a small fraction of that.
- `pagination_type=search_after` — offset pagination degrades badly on a large catalogue.

The two things that file exists to absorb, both **measured, not hypothetical**:

1. **A definition names an attribute the PIM doesn't have.** Akeneo doesn't skip it — it rejects the
   **whole request** with `422 Attribute "boost_levels" does not exist.` One stale row in a 71-row
   spreadsheet emptied the entire grid for 115 SKUs. So codes are checked against the PIM *first* and
   only existing ones are ever asked for; the rest are reported as "not in Akeneo" — *a definition to
   fix, not a page that fails*.
2. **Half the "single select" attributes are not selects.** `size_name`, `main_color` and
   `battery_type` are `akeneo_reference_entity` (or `_collection`), which have **records, not
   options** — so `/attributes/{code}/options` returns an empty list, leaving those fields with no
   choices *and* no code↔label map, so every one would read as diverging forever. Their choices come
   from `/reference-entities/{name}/records` instead.

Both answers are cached for 30 minutes: they're catalogue *configuration*, which changes on a release
cadence, not per page load.

**Endpoints** (`/apps/attribute-viewer`, 45 of them) — the ones that matter:

```
GET  /overview  /category?l3=  /eprel  /variant-groups  /pending  /audit  /locate
GET  /definitions [?include=attributes&since=]      ← the machine-facing sync + OPEN READ
GET  /definitions/:l3   /definitions/:l3/check   /definitions/suggest
GET  /attributes  /akeneo-attributes  /attributes/:code/options
GET  /export/akeneo    /changes/:sku    /compare?skus=   ← consumed by Roadmap
POST /definitions/validate
POST /import/values/{scan,preview}     POST /originflow/{lookup,preview}   GET /originflow/{status,raw/:sku}
─────── write barrier ───────
PUT/DELETE /values/:sku/:code    POST /values/{bulk,copy}
POST/DELETE /definitions[/:l3]   PUT /definitions/:l3/attributes
POST /definitions/:l3/{values/move, values/discard, attributes/link}
POST /attributes/merge   PUT /attributes/{catalogue-order,:id}   POST/DELETE /attributes/:id[/categories]
PUT  /skus/:sku/status   POST/PUT/DELETE /changes/:sku[/:entryId]
POST /import/values/apply   POST /originflow/apply
```

**Routing lives in the URL.** `l1`/`l2` (the branch in view), `l3` (what loads) and `sku` (the open
panel) are all query params, not local state — so each is a real address: back and forward walk
through them and a link can be shared straight to one. It talks to the History API directly rather
than through the platform router, because the platform only ever matches the URL's *first* path
segment against the registry.

**Rendering budget.** SKU **columns** are revealed 25 at a time (about two screens wide); a category
is 115 × 71 = 8,165 cells. Comparison mode ignores paging — somebody who ticked five products wants
all five. One frozen `NONE = Object.freeze([])` is shared by every "nothing loaded" fallback, because
a fresh `[]` per render is a new identity that would make every `useMemo` recompute — and those memos
filter and sort thousands of rows.

### 3.4 UI / UX in full

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ ▦ Attribute Viewer     🔒Edit │📖Definitions(13)│📚Catalogue│⬆Import values│☁From OriginFlow│
│ Every SKU in a category and its attributes — from Akeneo, with local edits flagged for      │
│ pushing back.          ✏Edit attributes │◫Variant groups(2)│☑To push(87)│🕐History│⟳Refresh│
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 🔍 Locate a product…  (landing page only — the grid has its own search)                      │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ LANDING: the CATEGORY BROWSER — not a filter, the entry point                                │
│  ▸ Kitchen                                    38 categories · 4,102 SKUs                     │
│  ▾ Home & Living                                                                             │
│      ▾ Extractor Hoods    [img][img][img]                                                    │
│          Angled Hoods            143 SKUs · 71 attributes  ✓                                 │
│          Ceiling Hoods            62 SKUs · no definition yet  ⚠                              │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ AFTER PICKING: breadcrumb  Home & Living › Extractor Hoods › Angled Hoods                    │
│ ┌──────┐┌────────┐┌────────┐┌────────┐┌────────┐┌───────────────────────────────┐            │
│ │ 143  ││  62%   ││   87   ││   14   ││   6    ││ Akeneo LIVE 14:20 · SKUs from ││ ← tiles are
│ │SKUs ·││of 10,153││to push││required││not in  ││ cache, 2h old · EPREL: 401    ││   TOGGLES
│ │71 att││cells   ││        ││gaps    ││Akeneo  ││ differ  ⟳re-detect            ││
│ └──────┘└────────┘└────────┘└────────┘└────────┘└───────────────────────────────┘            │
├─────────────────────────────────────────────────────────────────────────────────────────────┤
│ 143 of 143 SKUs · 71 of 71 attributes │ ⚙Filters(3) │ sorted by Air flow ▲ ✕ │ 5 selected:   │
│                                          [Compare] [Bulk fill] [Copy from…] [Clear]          │
├──────────┬──────────────────────────────────────────────────────────────────────────────────┤
│ FILTERS  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐   ← SKU column headers               │
│ (panel;  │  │ ☑ [img]│ │ ☐ [img]│ │ ☑ [img]│ │ ☐ [img]│     tick · thumb · number · desc     │
│ collapses│  │10035221│ │10035222│ │10041008│ │10041009│     shop link · status · counts      │
│ to a rail│  │Vinoline│ │Vinoline│ │Skyfall │ │Skyfall │     + a state BAND down the side     │
│ showing  │  │↗ ●Final│ │🔍 ○Prog│ │↗ ○Prog │ │↗ ○Prog │                                     │
│ the count│  └────────┘ └────────┘ └────────┘ └────────┘                                     │
│ )        │──────────────────────────────────────────────────────────────────────────────────│
│ Search   │ ▾ DIMENSIONS                                    (collapsible cluster band)        │
│ Show[▾]  │   Product width  92/143 ⇅ │  595    │  595    │  898    │  898    │              │
│ Clusters │   Product height 87/143 ⇅ │  1050   │  1050   │  (empty)│  1050   │              │
│ ☑Dims    │ ▾ PERFORMANCE                                                                    │
│ ☑Perf    │   Air flow ▲     143/143 ⇅ │  671    │  671    │  650    │  650    │             │
│ ☐Energy  │   💬 comment          m³/h │ ← unit above the value, in small grey type          │
│          │   Energy class    88/143 ⇅ │ [A++]   │ [A++]   │ [A+]⚑   │ [A]     │             │
│ per-attr │                            │         │         │EPREL A++│         │             │
│ value    │ ▾ · PRODUCT CHANGES (read-only band, outside the keyboard grid)                  │
│ filters  │   Last entry              │ 07/09   │ 07/09   │   —     │ 22/08   │              │
└──────────┴──────────────────────────────────────────────────────────────────────────────────┘
  LEGEND: ▨Changed ▨Added ▨Cleared ▨Synced ▫Akeneo ▫Empty ▨EPREL ■invalid · 2 invalid cells
```

**Why this way round** (and it earns the shape twice):
- A **SKU column** can carry an identity — thumbnail, number, description, shop link, tick box,
  status. None of that fits beside a row, and recognising a product by its picture is far faster than
  reading a name.
- An **attribute row** is one question asked of every product ("what is the grease-filter class
  here?"), so comparing across products is reading along a single line, and "which of these is
  missing it" is the gaps in that line.
- Cluster grouping gets simpler: a full-width band row is a real, collapsible section heading, where
  a `colspan` band above 70 columns was only a label.

**The column header** ([SkuHeader.jsx](src/apps/attribute-viewer/components/SkuHeader.jsx)), in the
order it answers "which product is this, and where is it up to": tick box → thumbnail → item number →
description → shop link → status → counts. Plus a **colour band down the side** in the same palette
as its cells — a band rather than a badge, because it has to be readable while scanning a hundred
columns, and the header is already full.

**The thumbnail** ([Thumb.jsx](src/apps/attribute-viewer/components/Thumb.jsx)) handles the failure
rather than avoiding it: not every item has a hero image and there's no way to know without asking, so
Cloudinary 404s and `onError` fires. The placeholder keeps the **same box size** — a missing one that
collapsed would misalign every column beside it. It accepts *multiple candidates* (the category
browser gives three, where the picture stands for a whole category, so which item provides it doesn't
matter — only that something loads), and each failure falls through to the next. Keyed on the item
number so moving to the next candidate **replaces** the element — swapping only `src` on a failed
`<img>` doesn't reliably re-fire `onError`. `loading="lazy"` is load-bearing.

**The category browser** is the app's entry point, not a filter: nothing loads until something is
picked, because loading a category means reading ~70 attributes for every one of its SKUs from the
PIM. It shows the **hierarchy** rather than a flat list because the catalogue is ~200 categories and
nobody holds that as one list — they hold it as "the hoods under Kitchen". Only categories **with a
definition** can be opened; ones without are still listed and marked — *"no definition yet" is a
thing to fix, not a category to hide.*

**Summary tiles are toggles, not one-way doors.** Clicking the tile for the filter it already applies
turns it back off, so nobody ends up in a filtered grid they can't find their way out of by clicking
the thing that got them there.

**Panels/dialogs:** Filter panel (collapsible→rail) · SKU panel (side drawer, all attributes by
cluster + change log) · Definition panel · Definition editor · Catalogue panel + detail ·
Pending/To-push panel · Variant groups · Import panel · OriginFlow panel · Bulk fill · Copy from ·
Quick copy · History · Reopen dialog · Option map dialog · Compare matrix.

**To-push panel:** **one row per change**, not per SKU. That's the unit of work — somebody updating
the PIM works through *changes*, not products — and a wide per-SKU table would have to be re-read to
find which of 70 columns actually moved. Opened from inside a category it scopes to *that* category
(the global count was 6,567 where the category had 87). Each row's verdict was decided the last time
its category was loaded; a row never compared is labelled **"not checked"** rather than silently
presented as a divergence.

### 3.5 Dependencies

| Dependency | Used for | Required today? |
|---|---|---|
| **SQL Server / Azure SQL** | definitions, values, status, changes, audit | **Yes** |
| **Shared product cache** | the SKU list and every product fact | **Yes** |
| **Warehouse** (via the cache) | item master, categories, shop feed, Akeneo-family view | **Yes**, as a button |
| **Akeneo REST API** | **the values, option/record vocabularies, types, families, variants, measurement families, the attribute catalogue, and the export target** | **Yes — structurally** |
| **EPREL registry** | the cross-check axis | Optional; fetched *after* render, cannot break the page |
| Cloudinary URL convention | thumbnails | Optional, zero-cost |
| **OriginFlow** (outbound) | reading back supplier-captured values | Optional |

**The Akeneo surface, itemised** — this is the list to replace:

| `akeneo.js` export | What it needs from the PIM |
|---|---|
| `describeAttributes(codes)` | does this code exist, what type is it, what reference entity |
| `fetchChoices` / `fetchChoiceMaps` | the option list, or the reference-entity records |
| `fetchProductValues(skus, codes)` | **the values** — batched 100 SKUs/request |
| `fetchTableRows` | the `product_changes` table attribute |
| `fetchFamilyAttributes` / `fetchFamilyRequired` | family membership, incl. **inheritance** |
| `fetchMeasurementFamilies` | unit symbols → unit codes |
| `fetchModelVariant` / `fetchVariantWritable` / `fetchSiblingAxisValues` | which attributes a variant row may carry |
| `scanPopulatedAttributes` | "Find what it populates" |
| `listAkeneoAttributes` / `searchAkeneoAttributes` | the type-ahead code search (1,628 attributes, cached 30 min) |
| `akeneoExport.js` | building and *validating* the import file |

**The two OriginFlow links today, and they are not symmetric** — worth stating because it's the exact
relationship being inverted:

- **Inbound:** OriginFlow reads *our* `GET /definitions` from an operator's browser on the VPN,
  **unauthenticated**. That's the *only* hole in the session barrier
  ([openReads.js](server/shared/auth/openReads.js)): GET-only, identical for every caller, cheap and
  local, named exactly, pinned by a test. It exists because a `SameSite=Lax` cookie is never sent
  cross-site, a bearer token would ship in OriginFlow's frontend bundle, and their server can't
  resolve our internal hostname. What makes it acceptable is that the network boundary — not the
  session — keeps the public out.
  *Hard-won detail:* the CORS options **reflect** the caller's origin rather than using a wildcard,
  because `Access-Control-Allow-Origin: *` is **refused by the browser** the moment the caller sends
  credentials — and the resulting bare connection failure looks exactly like being off the VPN,
  because a CORS rejection hides the `401` behind it.
- **Outbound:** *we* call OriginFlow server-to-server with a bearer token
  (`ORIGINFLOW_URL` + `ORIGINFLOW_SKU_TOKEN`), because OriginFlow is on the public internet holding
  unreleased product information. Their endpoint sends no CORS headers, so it's never called from the
  browser. **One SKU per request** — no bulk endpoint, no delta — so the fan-out is bounded, capped,
  and **never retried on a 401 or 404** (a 401 is a credential to fix; a 404 isn't a failure).

Everything OriginFlow-shaped in that importer is **a refusal to guess**, and each is a rule to keep:
an item number is **not unique** there, so one existing in several projects proposes *nothing* until
somebody picks which record it means · a SKU they don't know and a SKU they know with **nothing
captured yet** are counted apart · a value carrying **no Akeneo code** is listed as such, so a
reported gap isn't someone hunting for something already there · a value they don't hold **leaves
ours untouched** — nothing here ever proposes to *clear* a field · every value arrives as a string and
is cast by **our** field type, never theirs.

### 3.6 OriginFlow port — the real work

**Effort: ~2–3 weeks.** The module's shape survives; the value layer inverts.

**The inversion.** Today: *the PIM is the system of record, and this module stages corrections to push
back.* In a self-sustaining OriginFlow: **OriginFlow is the system of record.** That collapses a
surprising amount of complexity, because the divergence machinery exists only to reconcile two
systems.

#### Step 1 — Keep, unchanged

Everything that isn't about the PIM, which is most of the module's value:

- `attr_attribute` / `attr_category_attribute` — the **attribute-not-owned-by-a-category** model,
  GLOBAL attributes, per-category order and required-ness, clusters, comments.
- The **definition editor** in full, including batched save, "order is the rendered order", the GLOBAL
  badge/confirmation/report.
- The **grid**: transposed layout, collapsible cluster bands, sticky both axes, click-row-to-sort
  (type-aware, blanks last), tick-to-compare, per-row coverage, column paging.
- **All spreadsheet editing keys** — `Enter` down, `Tab` across, `Esc`, `F2`, arrows, `Shift+Enter`.
- The **SKU panel**, **filter panel→rail**, **summary tiles as toggles**, **category browser**,
  **URL-as-state**, **Thumb** fallback chain.
- **Field-type validation**, the `__no_value__` sentinel, `NULL`-means-cleared, text-verbatim storage.
- **Review status** with the server-side Final refusal + acknowledgement, and the reopen reason.
- **Bulk fill / copy-from**, defaulting to empty cells only, reporting per SKU.
- **Required-attribute gaps**, the count/badge/row filter.
- **History**, append-only, filterable, exportable.
- **Edit password** + positional write barrier.
- **`GET /definitions`** as the machine-facing endpoint, `updatedAt` moving for shared-attribute
  edits included. It becomes internal rather than cross-origin — **which means you can delete
  `openReads.js` entirely.** That's a security win, not a loss.

#### Step 2 — Replace the value source

`server/apps/attribute-viewer/akeneo.js` becomes `values-source.js` over OriginFlow's own store. The
interface is already narrow and well-documented; keep its signatures and the two batching parameters'
*intent*:

| Instead of | Do |
|---|---|
| `fetchProductValues(skus, codes)` from the PIM | read `attr_value` **directly** — it's already the only copy of a human's edit |
| `describeAttributes(codes)` | read `attr_attribute` — **the definition already declares type, options and unit** |
| `fetchChoices` / `fetchChoiceMaps` | the definition's option list, **already authoritative** (off-list values already render red) |
| `fetchMeasurementFamilies` | keep a small local symbol→code table, or drop unit codes entirely |
| `fetchFamilyAttributes` / variants | OriginFlow's own product grouping, if it has one; otherwise drop |
| `listAkeneoAttributes` / `searchAkeneoAttributes` | search `attr_attribute` — **and the 30-minute cache and the 17-page full read both disappear**, because a local `LIKE` has no `contains`-filter limitation |

**What collapses when the PIM goes away:**

- `akeneo_snapshot`, `diverges`, `checked_at` and the whole **six-state cell vocabulary** reduce to
  `filled` / `empty` / `invalid`. **Keep `invalid`** — off-list values are still real. Consider
  keeping one "recently changed" state if a change signal is wanted.
- **To push** stops being "push to Akeneo" and becomes either an **outbound feed to the shop / a
  downstream consumer**, or nothing. If a downstream consumer exists, **keep the export's
  all-or-nothing rule** — the reasoning is about *any* import target, not about Akeneo:
  *"a partial file handed over with a list of warnings is one somebody imports anyway."*
- The `422`-over-one-bad-code absorber, the reference-entity-vs-select discovery, and the
  option-code-vs-label folding all become unnecessary — **because you now control both vocabularies.**

**Keep the option conversion matrix anyway** if OriginFlow must talk to *any* external system (shop
feed, marketplace, a retailer's spec sheet). The pinned/inferred/ambiguous three-way distinction and
the "only pinned is fixed, everything else resolves on every read" rule are general, hard-won, and
will be needed again. Sources: [values.js](server/apps/attribute-viewer/values.js) ·
[OptionMapDialog.jsx](src/apps/attribute-viewer/components/OptionMapDialog.jsx)

#### Step 3 — Keep EPREL

It's a **separate registry**, not Akeneo, and it's the module's strongest independent verification
axis. Keep it *exactly* as built:

- Fetched in a **separate request after the grid renders** — a slow or rate-limited registry can never
  delay or break the page.
- The comparison's tolerance work (strip units, tolerate coarser precision, fold `a_plus_plus` ↔
  `AP`/`APP` ↔ `A+`/`A++`) — this is what makes it usable rather than 81 false mismatches.
- "EPREL has it, we don't" marked **separately** from "they disagree".
- **Edit-starts-from-EPREL**, including *"no safe equivalent ⇒ offer nothing"* and *"a cell with a
  pending edit is never re-seeded"*.

In a self-sustaining OriginFlow, EPREL becomes *the* external cross-check — arguably more valuable
than it is today, because there's no PIM to blame a divergence on.

#### Step 4 — Decide about the SKU list

Two options, and this is the main design decision:

- **(a) Keep the shared product cache.** OriginFlow keeps its warehouse mirror and the *"include
  every non-discontinued item, flag the unmaintained ones"* scope rule. **Recommended** — the
  "in Akeneo" column becomes "in OriginFlow" (same semantics: does the content system know this SKU)
  and the module keeps its whole reason for existing: finding gaps that are invisible if you only
  look at what's already maintained.
- **(b) OriginFlow's own product list.** Simpler, but you lose the ability to see items OriginFlow has
  never heard of — which is the population most likely to have gaps.

#### Step 5 — The importers

- **Spreadsheet importer** — keep verbatim. The three-stage scan → preview → apply and the shared
  server-side classifier are pure value.
- **From OriginFlow** — becomes a **local read**, so the bounded fan-out, the retry policy, the
  bearer-token connector and *Check connection* all disappear. But keep every one of the five
  refusals-to-guess in §3.5: non-unique item numbers, known-but-nothing-captured counted apart,
  values with no target code listed as such, absent values leaving ours untouched, and *our* field
  type doing the casting. Those are about **data honesty**, not about the transport.
- **Product Changes log** — keep, if OriginFlow has an equivalent per-SKU narrative. Keep the
  whole-table-per-cell rule that makes a partial export destructive.

#### Step 6 — Cross-app

`GET /compare?skus=` is consumed by Roadmap. Keep the route; it becomes a fast local read, which
removes the panel's laziness *requirement* (keep the laziness anyway).

---

## 4. Consolidated dependency matrix

| Dependency | Attribute Viewer | SP Matrix | Roadmap | Needed in a self-sustaining OriginFlow? |
|---|:--:|:--:|:--:|---|
| SQL Server / Azure SQL | ●●● | ●●● | ●●● | **Yes** |
| Shared product cache (`dbo.product_item`) | ●●● | ●●● | — | **Yes** (Roadmap gets its SKUs from the upload) |
| Warehouse `PL.PL_V_ITEM` | ●● | ●● | — | **Yes**, via the cache refresh button only |
| Warehouse `L0_AKENEO_ITEM_FAMILY` | ● | ● | — | Rename to "in OriginFlow", re-source |
| Warehouse `L0_SHOP_FEED_MASTER` | ● | ●● | — | **Yes** — the shop link and stock/price |
| **Akeneo REST API** | **●●●** | ● | — | **No.** AV: replace (§3.6 step 2). SPM: drop the Ⓛ flag. RM: nothing. |
| EPREL registry | ●● | — | — | **Keep** — the independent cross-check |
| Cloudinary URL convention | ● | ● | ● | Optional, zero API cost; swap if OriginFlow has assets |
| Jira | — | — | ● | Optional |
| `.xlsx` (`xlsx`) | ● (importer) | — | ●●● | **Yes** for Roadmap; that *is* its data source |
| `html2canvas` + `jspdf` | — | — | ● | Optional (PDF export) |
| SSO + per-module permissions | ●●● | ●●● | ●●● | **Yes** |
| Shared edit password | ●●● | ●●● | — | **Yes** (Roadmap relies on the permission barrier alone) |

● incidental · ●● important · ●●● structural

---

## 5. Suggested order of work

1. **Shared platform** — registry pattern, `PlatformProvider`, `migrate.js`, design tokens,
   `requirePermission` + edit-lock. *Prerequisite for all three.*
2. **Shared product cache** — `dbo.product_item`, the two-half refresh/read split, the scope rule,
   `ensureItems()`. *Prerequisite for AV + SPM.*
3. **Roadmap Creator** — no Akeneo work at all. Ships first, proves the platform, delivers value in
   days.
4. **SP Matrix** — port `ecodesign.js` untouched, decide about the Ⓛ flag (the "drop it" path is zero
   code).
5. **Attribute Viewer** — the value-layer inversion. Do it in this order:
   a. definitions + catalogue + editor (no values at all — already useful on its own);
   b. the grid reading `attr_value` directly, with the reduced cell-state vocabulary;
   c. EPREL back on;
   d. importers;
   e. the outbound export, *if* there's a downstream consumer.

## 6. Ten rules to carry over verbatim

These are the lines that took real incidents to learn. They're worth more than the code.

1. **A refresh must never be able to delete or overwrite what a person typed.** Roadmap's `MERGE`
   without `WHEN NOT MATCHED BY SOURCE`; SP Matrix having *no import endpoint at all*; Attribute
   Viewer's "an edit never loses to Akeneo". Make it **structural**, not careful.
2. **Show the items you can't see properly.** `ItemStatusMI IS NULL` items, SKUs missing from the
   content system, delisted SKUs that still carry notes. *A hidden gap is a gap that cannot be found.*
3. **Never let a slow upstream sit on a request path.** Mirror it locally; make the refresh a button;
   say how old the mirror is.
4. **An export is all-or-nothing.** A partial file plus a warning list is a file somebody imports
   anyway.
5. **Split obligation from preference.** SP Matrix's regulatory/policy tiers with a citable
   `legalRef`. A false compliance alarm costs more than a missing to-do.
6. **Two visually distinct kinds of link.** An arrow for a page that exists, a magnifier for a
   search — *a search link must never read as evidence something is listed.*
7. **Distinguish "checked and absent" from "not checked".** SP Matrix's five pro-part states;
   Attribute Viewer's "not checked" rows; the dash on an unfetched Ⓛ.
8. **Refuse to guess, and say what you refused.** Ambiguous option matches reported rather than
   picked; non-unique OriginFlow item numbers proposing nothing; "no safe equivalent ⇒ offer nothing".
9. **Status is hue *and* a label**, and a filter that's on must be visible even when its panel is
   collapsed.
10. **Presentation mode is a first-class feature.** Keep what identifies and what the tool is *about*;
    drop what's commercially sensitive. Persist it, and never disable it — the moment it's needed is
    the moment a supplier walks in.
