-- Migration 100: seed the "Supplier IM Intake" Claude Chat review prompt into
-- prompt_library (see migration 89) so it's available from Admin → Prompt
-- Library instead of only living in docs/im-import/review-prompt.md.
--
-- This is a one-time seed of the initial prompt text, not a synced copy: rows in
-- prompt_library are freely editable from the Admin panel (see
-- src/pages/AdminDashboard.tsx), and the app never re-reads docs/im-import/review-prompt.md
-- at runtime. If that doc is revised later (e.g. the review tasks or the
-- OriginFlow IM Import v1 schema change), update this row by hand in the Admin
-- panel — this migration will not overwrite an existing row (see WHERE NOT
-- EXISTS below), so it is safe to re-run and safe to have drifted from the doc.
--
-- Dollar-quoting ($prompt$...$prompt$) is used for prompt_text because the
-- prompt itself contains many literal single/double quotes (it's largely a
-- worked JSON example) that would otherwise need hand-escaping.

INSERT INTO prompt_library (title, description, prompt_text)
SELECT
  'Supplier IM Intake — Review & Diff (Claude Chat)',
  'Paste into a new Claude Chat conversation together with a supplier''s draft instruction manual (PDF/text/figures). Reviews, corrects, restructures, and translates the draft into a single OriginFlow IM Import v1 JSON document. Optionally compares against an existing category template (paste the output of exportTemplateForReview) to mark sections as already covered, needing adjustment, or new — see docs/im-import/schema.md and review-prompt.md.',
  $prompt$
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
$prompt$
WHERE NOT EXISTS (
  SELECT 1 FROM prompt_library WHERE title = 'Supplier IM Intake — Review & Diff (Claude Chat)'
);
