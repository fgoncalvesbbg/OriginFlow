# Supplier IM Intake — Claude Chat Review Prompt

> **In-app shortcut.** This prompt (both the IM and Warning Leaflet variants) is also generated
> live in the app — click **Get the prompt** next to any **Import from JSON** button (Category
> Templates and the project IM generator) to copy it with your category/languages already filled
> in, via `src/pages/im/ImportPromptGuide.tsx` / `src/services/im/im-import-prompt.ts`. This doc
> stays the reference copy for the `im` variant and is kept in sync with that generator.

Paste everything in the **Prompt** block below into a new Claude Chat conversation, then attach or
paste the supplier's draft (PDF, extracted text, and image descriptions). The output is a single
JSON document conforming to `OriginFlow IM Import v1` (see [`schema.md`](./schema.md)).

For a **Warning Leaflet** (a short, safety-focused document, not a full manual — see
`IMTemplateRegulations.tsx`), use the Warning Leaflet toggle in the in-app prompt guide instead of
this doc: it swaps task 3's chapter structure for a compact warning-leaflet layout (General Safety
Warnings → Specific Hazard Warnings → Symbols and Their Meaning → Correct Use reminders →
Disposal) and fixes `"kind": "warning_leaflet"` — everything else (callout mapping, HTML rules,
scope/diff tasks, schema) is identical to the `im` prompt below.

**How to use**
1. Open the supplier PDF. Attach it to Claude Chat (or paste the text + describe each figure).
2. **If the project is already on a real category template** and you want this draft layered on
   top of it (rather than creating a template-free project or a brand-new template), export that
   template first: call `exportTemplateForReview(templateId)`
   (`src/services/im/im-import.service.ts`) — or use the "Export template for review" action in
   the project's IM generator — and copy its JSON output. This is optional; skip it entirely for a
   fresh category with no existing template.
3. Paste the entire prompt below as your first message, then the draft.
4. Fill the bracketed placeholders at the top (`[[CATEGORY]]`, `[[TARGET LANGUAGES]]`, and
   `[[EXISTING TEMPLATE EXPORT]]` if you have one from step 2 — otherwise write "none").
5. Copy the JSON it returns into a `.import.json` file. Review `reviewNotes` and
   `excludedStandardized` before doing anything with it.

---

## Prompt

````
You are an expert technical writer and product-compliance reviewer specializing in instruction
manuals (IMs) for household appliances sold in the EU/UK. I will give you a supplier's draft
instruction manual (text and/or figures). Your job is to review, correct, and restructure it into
a single clean JSON document that I will import into our IM tool.

CONTEXT YOU MUST ASSUME
- Product category: [[CATEGORY]]   (e.g. "Coffee Machines")
- Target languages: [[TARGET LANGUAGES]]   (e.g. en, de). "en" is the source language.
- Existing category template export (optional — "none" if there isn't one yet):
  [[EXISTING TEMPLATE EXPORT]]
- Our platform AUTOMATICALLY adds standardized boilerplate to every manual: company info /
  imprint, the WEEE crossed-out-bin disposal block, the generic EU/UK Declaration of Conformity,
  and CE/UKCA/WEEE mark images. You MUST therefore REMOVE this standardized content from the draft
  and instead list what you removed. Keep only product-specific content.
- This JSON is imported into a CATEGORY TEMPLATE that will be REUSED by every product in the
  category, not just this one model. So you must (a) write shared content as standardized and
  reusable as possible, and (b) label what is dedicated to this specific model — see task 8.

YOUR TASKS
1. REVIEW & CORRECT the draft: fix factual contradictions, unclear steps, wrong terminology, and
   inconsistent structure. Improve clarity and tone for an end user.
2. NEVER INVENT technical facts. If a spec, dimension, rating, or instruction is missing or
   ambiguous, do NOT guess — add it to reviewNotes.openQuestions instead.
3. NORMALIZE STRUCTURE to this standard chapter order, including chapters the draft is missing
   (create them if the information exists; otherwise flag the gap in reviewNotes):
   Intended Use → Safety Instructions → Parts and Controls → Setup and First Use → Operation →
   Cleaning and Maintenance → Troubleshooting → Technical Specifications → Disposal.
4. STRIP STANDARDIZED BOILERPLATE (company info/imprint, WEEE symbol & generic disposal text,
   generic conformity declarations, marketing blurb) and record each removed item as a short
   string in excludedStandardized. In the Disposal chapter, keep only genuinely product-specific
   notes (e.g. packaging separation), NOT the standard WEEE block.
5. MAP EVERY WARNING to the correct callout variant:
   - "warning"   → general risk of serious injury
   - "caution"   → risk of minor injury or damage
   - "electric"  → electric-shock hazard
   - "flammable" → fire / flammable-material hazard
   - "info"      → important non-hazard note
   Put ONLY the message text in the callout's content — do NOT write any wrapper markup.
6. SPECIFY NEEDED IMAGES. You cannot create images. Wherever a figure is needed (parts diagram,
   assembly step, control layout, etc.), emit an "image" block with an "imageNeed" object that
   precisely describes the required image, its purpose, any callout-number annotations, and where
   in the supplier draft it might come from. Leave its "content" maps empty ("").
7. TRANSLATE all human-readable text into every target language. Keep "en" (source) always
   present. If you are unsure of a technical translation, keep the source-language text and note
   it in reviewNotes.openQuestions rather than guessing.
8. STANDARDIZE AND CLASSIFY BY SCOPE (this file feeds a reusable category template):
   - Prefer GENERIC content. For anything that is true for all or most products in the category
     (general safety, intended use, standard cleaning/operation), rewrite it in neutral, reusable,
     compliant wording that would apply to any model in the category, and set "scope":"generic"
     (or omit scope — generic is the default).
   - Mark MODEL-SPECIFIC content with "scope":"model-specific": exact technical specifications,
     this model's part/control layout, model-number-dependent steps — anything that would be wrong
     if reused for a different model in the category.
   - Granularity: prefer a generic section that contains a few model-specific BLOCKS over marking a
     whole section model-specific. Only set a whole SECTION to "scope":"model-specific" when the
     entire chapter is dedicated to this model (e.g. a "Technical Specifications" table).
   - NEVER drop compliance content to make something generic. If a safety statement is
     model-specific, keep it and mark it model-specific rather than removing it.
9. COMPARE AGAINST THE EXISTING TEMPLATE (only if one was provided above — otherwise skip this
   task and omit matchStatus from every section, which defaults to "new"):
   - For each section you draft, check whether the existing template export already has an
     equivalent section (compare by topic/meaning, not exact wording).
   - Already substantively covered → set "matchStatus":"matches-template" and
     "matchedSectionKey" to that existing section's "key". Do NOT re-emit its content — leave
     "blocks" empty ([]).
   - Same topic, but this model needs extra or different detail (e.g. a differing spec, an added
     caveat) → set "matchStatus":"adjust-template" and "matchedSectionKey" to that section's
     "key". Put ONLY the differing block(s) in "blocks" — not the whole chapter rewritten.
   - No equivalent exists → set "matchStatus":"new" (or omit it) and draft the section in full,
     as usual.
   - This check is about the TEMPLATE's actual existing content, not general category knowledge —
     only mark matches-template/adjust-template against a section literally present in the
     export you were given.

GROUPING (important — avoid one-block-per-sentence)
- Each block becomes its OWN editable row in the tool. So GROUP related prose: a block of type
  "paragraph" should hold a COMPLETE paragraph, and you may put several related paragraphs in one
  block by using multiple <p> tags inside its content (e.g. "<p>First.</p><p>Second.</p>").
- Do NOT emit a separate block for each sentence or line. A typical body chapter is 1–4 paragraph
  blocks, not one per sentence. Only start a new block when the content type changes (a heading, a
  callout, a table, an image) or when scope changes (generic vs model-specific).
- Every paragraph's text MUST be wrapped in <p>…</p> (never bare text or a stray <span>/<div>).

HTML RULES (content maps)
- content values are HTML strings, per language.
- Use ONLY these tags: <p>, <h1>, <h2>, <h3>, <strong>, <em>, <u>, <br/>, and tables as
  <table class="im-table"><thead><tr><th>…</th></tr></thead><tbody><tr><td>…</td></tr></tbody></table>.
- Do NOT use lists (<ul>/<ol>/<li>), links (<a>), <style>, <script>, custom classes, or any
  hand-written callout/placeholder markup. Express a list as separate <p> lines or a table.

OUTPUT
- Output ONE valid JSON document and NOTHING else — no explanation, no markdown fences, no prose
  before or after. It must parse with JSON.parse.
- Conform exactly to the schema below.

SCHEMA (OriginFlow IM Import v1)
{
  "importSchemaVersion": 1,
  "kind": "im",                       // "im" | "warning_leaflet"
  "category": "<the category above>",
  "product": { "name": "…", "sku": "…", "supplier": "…" },
  "languages": ["en", "…"],
  "sourceLanguage": "en",
  "cover": { "title": { "en": "…" }, "imageNeed": { … } },   // optional
  "sections": [
    {
      "key": "safety",               // unique slug within the file
      "parentKey": null,             // another section's key for nesting, or null
      "order": 1,
      "title": { "en": "…" },        // language map
      "scope": "generic",            // optional: "generic" (default) | "model-specific"
      "matchStatus": "new",          // optional: "new" (default) | "matches-template" | "adjust-template"
      "matchedSectionKey": null,     // required if matchStatus is matches-template/adjust-template
      "blocks": [
        { "type": "paragraph", "content": { "en": "<p>…</p>" }, "scope": "generic", "note": "optional" },
        { "type": "heading", "level": 2, "content": { "en": "<h2>…</h2>" } },
        { "type": "callout", "variant": "electric", "content": { "en": "<p>…</p>" } },
        { "type": "table", "content": { "en": "<table class=\"im-table\">…</table>" }, "scope": "model-specific" },
        { "type": "image",
          "imageNeed": { "description": "…", "purpose": "…", "annotations": ["1 = …"], "suggestedSource": "…" },
          "content": { "en": "" } }
      ]
    }
  ],
  "backPage": { "content": { "en": "<p>…</p>" } },   // optional; usually omit
  "excludedStandardized": ["WEEE disposal block", "company imprint", "…"],
  "reviewNotes": {
    "corrections": ["…"], "additionsSuggested": ["…"],
    "deletions": ["…"], "openQuestions": ["…"]
  }
}

WORKED FRAGMENT (illustrates the exact shape — your full output covers all chapters)
{
  "importSchemaVersion": 1,
  "kind": "im",
  "category": "Coffee Machines",
  "product": { "name": "BrewMaster 500", "sku": "KL-BM500", "supplier": "Homelux" },
  "languages": ["en", "de"],
  "sourceLanguage": "en",
  "sections": [
    {
      "key": "safety", "parentKey": null, "order": 2,
      "title": { "en": "Safety Instructions", "de": "Sicherheitshinweise" },
      "blocks": [
        { "type": "callout", "variant": "electric",
          "content": {
            "en": "<p>Do not immerse the base, cord, or plug in water. Risk of electric shock.</p>",
            "de": "<p>Sockel, Kabel oder Stecker nicht in Wasser tauchen. Stromschlaggefahr.</p>" } }
      ]
    },
    {
      "key": "parts", "parentKey": null, "order": 3,
      "title": { "en": "Parts and Controls", "de": "Teile und Bedienelemente" },
      "scope": "model-specific",
      "blocks": [
        { "type": "image",
          "imageNeed": { "description": "Labelled front view identifying all user-facing parts",
                         "purpose": "parts overview", "annotations": ["1 = water tank", "2 = portafilter"],
                         "suggestedSource": "supplier PDF p.3, figure 1" },
          "content": { "en": "", "de": "" } }
      ]
    },
    {
      "key": "specs", "parentKey": null, "order": 8,
      "title": { "en": "Technical Specifications", "de": "Technische Daten" },
      "scope": "model-specific",
      "blocks": [
        { "type": "table", "scope": "model-specific",
          "content": { "en": "<table class=\"im-table\"><thead><tr><th>Spec</th><th>Value</th></tr></thead><tbody><tr><td>Rated power</td><td>1450 W</td></tr></tbody></table>" } }
      ]
    },
    {
      "key": "intended-use", "parentKey": null, "order": 1,
      "title": { "en": "Intended Use", "de": "Bestimmungsgemäße Verwendung" },
      "matchStatus": "matches-template", "matchedSectionKey": "9f3a1c2b-0000-4d21-8e77-…",
      "blocks": []
    },
    {
      "key": "cleaning", "parentKey": null, "order": 6,
      "title": { "en": "Cleaning and Maintenance", "de": "Reinigung und Pflege" },
      "matchStatus": "adjust-template", "matchedSectionKey": "1a2b3c4d-0000-4d21-8e77-…",
      "blocks": [
        { "type": "paragraph",
          "content": { "en": "<p>This model's descaling cartridge must be replaced every 3 months, not the standard 2.</p>",
                       "de": "<p>Bei diesem Modell muss die Entkalkungskartusche alle 3 Monate statt der üblichen 2 Monate ausgetauscht werden.</p>" } }
      ]
    }
  ],
  "excludedStandardized": ["WEEE disposal block", "company imprint", "generic CE declaration"],
  "reviewNotes": {
    "corrections": ["Fixed descaling interval contradiction (2 vs 3 months)."],
    "additionsSuggested": ["Added missing Intended Use chapter."],
    "deletions": ["Removed marketing copy from safety section."],
    "openQuestions": ["Rated power not stated in draft — confirm with supplier."]
  }
}

Now wait for the supplier draft in my next message, then produce the JSON.
````

---

## After you get the JSON

- Save it as `something.import.json`.
- Read `reviewNotes.openQuestions` first — these are the gaps to resolve with the supplier.
- Confirm `excludedStandardized` really lists the WEEE/company/conformity content (the platform
  adds those back automatically).
- Validate against the checklist in [`schema.md`](./schema.md#validation-checklist-manual-until-the-importer-exists).
- **Import it — three options (same file):**
  - **Reusable category template:** **Instruction Manuals → Category Templates → Import from JSON**
    → confirm the category + name → **Create template**. Then open a project, pick the new
    template, and generate/edit/publish. Best when many products share the category.
  - **Quick, project-only:** open the project's IM generator → **Import from JSON**. Creates a
    100% project-based manual (no category template) you can edit and publish immediately. Best for
    fast one-off projects.
  - **Diff onto the project's existing template:** if you exported the template in step 2 and
    the doc uses `matchStatus`/`matchedSectionKey`, open the project's IM generator →
    **Import supplier draft (diff)**. Keeps the project's real template bound as-is, skips
    `matches-template` sections, and adds `new`/`adjust-template` content as project-only overlay —
    same principle as the quick project-only import, but merged onto a real template instead of
    the blank one. Best when the project already has a category template and the draft mostly
    duplicates it.
  Standardized content (company/WEEE/conformity) is added by the platform, not the file.
