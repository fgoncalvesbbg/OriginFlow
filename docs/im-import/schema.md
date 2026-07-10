# OriginFlow IM Import — `OriginFlow IM Import v1`

A structured JSON interchange format for bringing an AI-reviewed supplier instruction manual
into OriginFlow. It is produced by running a supplier PDF draft through the Claude Chat review
prompt (see [`review-prompt.md`](./review-prompt.md)) and is designed to map **1:1** onto the
platform's internal IM section/block model so an eventual import is mechanical.

> **Status.** Live, two landing modes (same file works for both):
> 1. **Category template** — **Instruction Manuals → Category Templates → Import from JSON**.
>    Creates a reusable `im_templates` + `im_sections` for a category; every project in that
>    category can then generate from it. Model-specific content imports as opt-in placeholders.
> 2. **Project-based (quick, template-free)** — open a project's IM generator → **Import from
>    JSON**. Binds the project to a shared **Blank Standardized Template** and stores all content
>    in the project's overlay (`extraSections`) — no category template is created or maintained.
>    Model-specific content renders normally (it's a one-off). Best for fast single projects.
>    Caveat: extra-section **headings** use the source language only (block text still translates).
>
> Both go through `src/services/im/im-import.service.ts` and the existing resolve/publish/print
> pipeline unchanged. Standardized content (company/WEEE/conformity) is added by the platform and
> must NOT be in the file.

---

## Why this shape

Every field maps to something concrete in `src/types/im.types.ts`:

| Import field | Internal target |
|---|---|
| `sections[]` | `im_sections` rows (tree via `parent_id`, ordered by `order`) |
| `section.title` | `title` + `title_i18n` (`Record<lang, string>`) |
| `section.blocks[]` | `im_sections.block_refs` — ordered `BlockRef[]` |
| a text/heading/callout/table block | `{ kind: 'inline', content: Record<lang, html>, variant? }` |
| an `image` block | inline image placeholder (`isPlaceholder: true`); the `imageNeed` tells the user what to upload |
| a `model-specific` block | inline block with `isPlaceholder: true` (opt-in, not auto-reused) |
| a `model-specific` section | placeholder section (`is_placeholder: true`) — flagged for per-project re-authoring |
| `excludedStandardized`, `reviewNotes` | **audit / human-review only — never imported into structure** |

The file is imported into a **category template** (shared by every project in that category), so
each section/block declares a `scope` (see [Generic vs model-specific](#generic-vs-model-specific))
telling the importer what is reusable standard content versus what is dedicated to this one model.

---

## Top-level object

```jsonc
{
  "importSchemaVersion": 1,           // integer, required. Only 1 exists today.
  "kind": "im",                       // required. "im" | "warning_leaflet"
  "category": "Coffee Machines",      // required. Human label; matched to a categories_l3 row at import time.
  "product": {                        // required
    "name": "…",                      //   required
    "sku": "…",                       //   optional
    "supplier": "…"                   //   optional
  },
  "languages": ["en", "de"],          // required. Every language key that appears in any content map.
  "sourceLanguage": "en",             // required. Must be one of `languages`.
  "cover": { … },                     // optional. See "Cover".
  "sections": [ … ],                  // required, non-empty. See "Section".
  "backPage": { … },                  // optional. See "Back page".
  "excludedStandardized": [ … ],      // optional audit list (strings). See "Audit fields".
  "reviewNotes": { … }                // optional audit object. See "Audit fields".
}
```

### Language maps

Every human-readable string that can be translated is a **language map**: `Record<lang, string>`
where keys are the ISO codes in `languages`. `sourceLanguage` should always be present in each
map; other languages are optional (missing ones fall back to `sourceLanguage` at render time, per
the resolver). Example: `{ "en": "Safety Instructions", "de": "Sicherheitshinweise" }`.

---

## Cover

```jsonc
"cover": {
  "title": { "en": "Espresso Machine — User Manual" },   // language map, optional
  "imageNeed": { … }                                     // optional, see "imageNeed"
}
```

Cover title maps to the project cover override (`placeholderData.__cover_title`). The cover image
is not authored here as a URL — if one is needed, express it as an `imageNeed`.

---

## Section

```jsonc
{
  "key": "safety",                    // required. Stable slug; unique within the file. Used for ordering & parentKey refs.
  "parentKey": null,                  // optional. Another section's `key` to nest under; null/omitted = top level.
  "order": 1,                         // required. Integer sort order among siblings.
  "title": { "en": "Safety", "de": "Sicherheit" },   // required language map
  "scope": "generic",                 // optional: "generic" (default) | "model-specific". See below.
  "blocks": [ … ]                     // required, may be empty. Ordered content. See "Block".
}
```

- `key` is authoring-side only — the importer assigns real UUIDs and resolves `parentKey` → `parent_id`.
- Keep the chapter order aligned with the standard IM structure (see the review prompt).
- `scope: "model-specific"` marks a **whole dedicated chapter** — imported as a placeholder section
  (renders its default content but flagged for per-project re-authoring).

---

## Block

A block is one entry in a section's ordered content. `type` selects the shape. Every block may
carry an optional `scope` (`"generic"` default, or `"model-specific"`) and an authoring-only
`note`. See [Generic vs model-specific](#generic-vs-model-specific).

### `paragraph`

```jsonc
{
  "type": "paragraph",
  "content": { "en": "<p>Fill the tank to the MAX line before use.</p>" },
  "note": "authoring guidance, not rendered"   // optional
}
```

### `heading`

```jsonc
{
  "type": "heading",
  "level": 2,                          // 1 | 2 | 3
  "content": { "en": "<h2>Before first use</h2>" }
}
```

### `callout` (safety box)

```jsonc
{
  "type": "callout",
  "variant": "electric",               // required: warning | caution | electric | flammable | info
  "content": { "en": "<p>Do not immerse the base in water.</p>" }
}
```

The `variant` drives the ISO 7010/7000 icon + box styling at render time. **Do not** hand-author
the `im-block-wrapper` markup — just set `variant` and put the message text in `content`.

### `table`

```jsonc
{
  "type": "table",
  "content": {
    "en": "<table class=\"im-table\"><thead><tr><th>Spec</th><th>Value</th></tr></thead><tbody><tr><td>Rated power</td><td>1450 W</td></tr></tbody></table>"
  }
}
```

Always include the `im-table` class and a `<thead>`/`<tbody>` structure.

### `image` (needed image placeholder)

```jsonc
{
  "type": "image",
  "imageNeed": {                       // required for image blocks
    "description": "Top-down diagram of the removable water tank",
    "purpose": "assembly step 3",      // optional
    "annotations": ["1 = lid", "2 = filter", "3 = max line"],   // optional
    "suggestedSource": "supplier PDF p.4, figure 2"             // optional
  },
  "content": { "en": "" }              // empty until the user uploads the asset in-app
}
```

The AI cannot produce final images. An `image` block records **what image is needed** so the user
can source/upload it later (via the in-app asset upload → `im-assets` bucket). `content` stays
empty. Image blocks are always imported as placeholders regardless of `scope`.

---

## Generic vs model-specific

The file becomes a **category template** shared by every project in the category (e.g. all coffee
machines), so the reviewer classifies each section and block with `scope`:

- **`generic`** (default) — content correct for **all or most** models in the category (general
  safety, intended use, standard cleaning/operation steps written as neutrally as possible). This
  becomes standard, auto-included template content that every project inherits. Write it as
  standardized as you can while staying compliant.
- **`model-specific`** — content that only applies to **this** model (exact technical
  specifications, this model's part layout, model-number-dependent steps). This is imported as a
  **placeholder** so it is not silently reused for a different model:
  - a **block** with `scope: "model-specific"` → `InlineBlockRef.isPlaceholder = true` (an opt-in
    row the PM consciously includes per project; **not** auto-rendered).
  - a **section** with `scope: "model-specific"` → a placeholder section (`is_placeholder = true`):
    it keeps its compliant default content but is flagged for per-project re-authoring.

Rule of thumb: **maximize generic content.** Only flag as model-specific what genuinely cannot be
shared. A single mostly-generic chapter with one model-specific value is better expressed as a
generic section containing one `model-specific` block than as a whole model-specific section.

---

## Back page

```jsonc
"backPage": { "content": { "en": "<p>…</p>" } }
```

Optional. Usually **omit** this — company address, WEEE, and conformity boilerplate come from
template metadata / reusable blocks / cover marks, not per-manual authoring. Only use it for
genuinely product-specific end-of-manual content.

---

## Audit fields (never imported into structure)

```jsonc
"excludedStandardized": [
  "WEEE symbol disposal block",
  "company address / imprint",
  "generic CE declaration paragraph"
],
"reviewNotes": {
  "corrections":       ["Fixed contradictory descaling interval (was both 2 and 3 months)"],
  "additionsSuggested":["Added missing 'Intended use' chapter"],
  "deletions":         ["Removed marketing copy from safety section"],
  "openQuestions":     ["Rated power not stated in draft — confirm with supplier"]
}
```

These capture the AI's review report for the human. They are read during review and discarded by
the importer.

---

## HTML rules (important)

Content HTML is sanitized on render with DOMPurify's default HTML+SVG profile. To keep imported
content **fully editable as structured blocks** (rather than opaque raw HTML), restrict authored
HTML to the tag set the block editor itself produces:

**Allowed:** `<p>`, `<h1>`, `<h2>`, `<h3>`, `<strong>`, `<em>`, `<u>`, `<br/>`,
`<table class="im-table">` with `<thead>/<tbody>/<tr>/<th>/<td>`.

**Avoid:** lists (`<ul>/<ol>/<li>`), links (`<a>`), inline `<style>`/`<script>`, custom classes,
and hand-written callout/placeholder `<span>`/`<div>` markup. (Lists/links technically render, but
they degrade to non-editable raw HTML blocks. Express a list as separate `<p>` lines or a table.)

**Grouping:** each block is its own editable row, so **group prose — do not emit one block per
sentence.** A `paragraph` block should hold a complete paragraph, and may contain several `<p>`
paragraphs in one content string. As a safety net the importer wraps bare text in `<p>` and merges
each consecutive run of same-scope **flow** blocks (paragraph + heading + table) into a single ref —
so a sub-heading and the paragraphs under it become one grouped block. Only callouts (a whole-ref
variant box) and images (placeholders) stay standalone. Well-grouped input still imports best, but
sub-heading-per-block structure no longer fragments the chapter.

---

## Validation checklist (manual, until the importer exists)

- Top-level `importSchemaVersion`, `kind`, `category`, `product.name`, `languages`,
  `sourceLanguage`, `sections` all present.
- `sourceLanguage` ∈ `languages`; every content-map key ∈ `languages`.
- Every `section.key` is unique; every `parentKey` refers to an existing `key`.
- Every `callout` has a valid `variant`; every `image` has an `imageNeed`.
- Content HTML uses only the allowed tag set above.
- `excludedStandardized` lists the stripped WEEE/company/conformity content.

See [`example.import.json`](./example.import.json) for a filled coffee-machine example.
