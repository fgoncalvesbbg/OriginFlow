/**
 * Builds the Claude Chat review prompt for `OriginFlow IM Import v1` JSON — the same
 * prompt documented in docs/im-import/review-prompt.md, generated here so the in-app
 * "Prompt guide" (ImportPromptGuide.tsx) can show/copy it without a repo detour, with
 * the category/languages placeholders optionally pre-filled.
 *
 * Keep this in sync with docs/im-import/review-prompt.md and schema.md — both describe
 * the same `OriginFlow IM Import v1` contract consumed by im-import.service.ts.
 */
import type { IMTemplateType } from '../../types';

export interface ImImportPromptOptions {
  category?: string;
  /** Comma/space separated language codes, e.g. "en, de". */
  languages?: string;
  /** Paste of exportTemplateForReview() output, for the diff-aware flow. */
  existingTemplateExport?: string;
}

const CALLOUT_MAPPING = `5. MAP EVERY WARNING to the correct callout variant:
   - "warning"   → general risk of serious injury
   - "caution"   → risk of minor injury or damage
   - "electric"  → electric-shock hazard
   - "flammable" → fire / flammable-material hazard
   - "info"      → important non-hazard note
   Put ONLY the message text in the callout's content — do NOT write any wrapper markup.`;

const SCOPE_TASK = (docLabel: string) => `8. STANDARDIZE AND CLASSIFY BY SCOPE (this file feeds a reusable category template):
   - Prefer GENERIC content. For anything that is true for all or most products in the category
     (general safety, intended use, standard cleaning/operation), rewrite it in neutral, reusable,
     compliant wording that would apply to any model in the category, and set "scope":"generic"
     (or omit scope — generic is the default).
   - Mark MODEL-SPECIFIC content with "scope":"model-specific": exact technical specifications,
     this model's part/control layout, model-number-dependent steps — anything that would be wrong
     if reused for a different model in the category.
   - Granularity: prefer a generic section that contains a few model-specific BLOCKS over marking a
     whole section model-specific. Only set a whole SECTION to "scope":"model-specific" when the
     entire ${docLabel} is dedicated to this model.
   - NEVER drop compliance content to make something generic. If a safety statement is
     model-specific, keep it and mark it model-specific rather than removing it.`;

const DIFF_TASK = `9. COMPARE AGAINST THE EXISTING TEMPLATE (only if one was provided above — otherwise skip this
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
     export you were given.`;

const GROUPING_AND_HTML_RULES = `GROUPING (important — avoid one-block-per-sentence)
- Each block becomes its OWN editable row in the tool. So GROUP related prose: a block of type
  "paragraph" should hold a COMPLETE paragraph, and you may put several related paragraphs in one
  block by using multiple <p> tags inside its content (e.g. "<p>First.</p><p>Second.</p>").
- Do NOT emit a separate block for each sentence or line. Only start a new block when the content
  type changes (a heading, a callout, a table, an image) or when scope changes (generic vs
  model-specific).
- Every paragraph's text MUST be wrapped in <p>…</p> (never bare text or a stray <span>/<div>).

HTML RULES (content maps)
- content values are HTML strings, per language.
- Use ONLY these tags: <p>, <h1>, <h2>, <h3>, <strong>, <em>, <u>, <br/>, and tables as
  <table class="im-table"><thead><tr><th>…</th></tr></thead><tbody><tr><td>…</td></tr></tbody></table>.
- Do NOT use lists (<ul>/<ol>/<li>), links (<a>), <style>, <script>, custom classes, or any
  hand-written callout/placeholder markup. Express a list as separate <p> lines or a table.`;

const BLOCK_SHAPES = `        { "type": "paragraph", "content": { "en": "<p>…</p>" }, "scope": "generic", "note": "optional" },
        { "type": "heading", "level": 2, "content": { "en": "<h2>…</h2>" } },
        { "type": "callout", "variant": "electric", "content": { "en": "<p>…</p>" } },
        { "type": "table", "content": { "en": "<table class=\\"im-table\\">…</table>" }, "scope": "model-specific" },
        { "type": "image",
          "imageNeed": { "description": "…", "purpose": "…", "annotations": ["1 = …"], "suggestedSource": "…" },
          "content": { "en": "" } }`;

const IM_INTENT = `You are an expert technical writer and product-compliance reviewer specializing in instruction
manuals (IMs) for household appliances sold in the EU/UK. I will give you a supplier's draft
instruction manual (text and/or figures). Your job is to review, correct, and restructure it into
a single clean JSON document that I will import into our IM tool.`;

const IM_CONTEXT = (cat: string, langs: string, existing: string) => `CONTEXT YOU MUST ASSUME
- Product category: ${cat}
- Target languages: ${langs}. "en" is the source language.
- Existing category template export (optional — "none" if there isn't one yet):
  ${existing}
- Our platform AUTOMATICALLY adds standardized boilerplate to every manual: company info /
  imprint, the WEEE crossed-out-bin disposal block, the generic EU/UK Declaration of Conformity,
  and CE/UKCA/WEEE mark images. You MUST therefore REMOVE this standardized content from the draft
  and instead list what you removed. Keep only product-specific content.
- This JSON is imported into a CATEGORY TEMPLATE that will be REUSED by every product in the
  category, not just this one model. So you must (a) write shared content as standardized and
  reusable as possible, and (b) label what is dedicated to this specific model — see task 8.`;

const IM_STRUCTURE_TASK = `3. NORMALIZE STRUCTURE to this standard chapter order, including chapters the draft is missing
   (create them if the information exists; otherwise flag the gap in reviewNotes):
   Intended Use → Safety Instructions → Parts and Controls → Setup and First Use → Operation →
   Cleaning and Maintenance → Troubleshooting → Technical Specifications → Disposal.`;

const WL_INTENT = `You are an expert technical writer and product-compliance reviewer specializing in the WARNING
LEAFLET — the short, safety-focused printed insert that must legally accompany household
appliances sold in the EU/UK, separate from the full instruction manual. I will give you a
supplier's draft warning leaflet, or a full manual/PDF to extract the safety-relevant content
from (text and/or figures). Your job is to review, correct, and restructure it into a single
clean JSON document that I will import into our IM tool.`;

const WL_CONTEXT = (cat: string, langs: string, existing: string) => `CONTEXT YOU MUST ASSUME
- Product category: ${cat}
- Target languages: ${langs}. "en" is the source language.
- Existing category template export (optional — "none" if there isn't one yet):
  ${existing}
- Our platform AUTOMATICALLY adds standardized boilerplate to every leaflet: company info /
  imprint, the WEEE crossed-out-bin disposal block, the generic EU/UK Declaration of Conformity,
  and CE/UKCA/WEEE mark images. You MUST therefore REMOVE this standardized content from the draft
  and instead list what you removed. Keep only product-specific content.
- This JSON is imported into a CATEGORY TEMPLATE that will be REUSED by every product in the
  category, not just this one model. So you must (a) write shared content as standardized and
  reusable as possible, and (b) label what is dedicated to this specific model — see task 8.
- A Warning Leaflet is NOT a full instruction manual. Do NOT draft operational chapters — Parts
  and Controls, Setup and First Use, Operation, Troubleshooting, or Technical Specifications
  belong in the Instruction Manual, not here. If the source is a full manual, extract ONLY its
  safety-relevant content (warnings, hazard notices, symbols, age/children restrictions, disposal
  warnings) and ignore the rest.`;

const WL_STRUCTURE_TASK = `3. NORMALIZE STRUCTURE to a compact warning-leaflet layout, creating ONLY the chapters the
   draft's content actually supports (never invent an empty one — flag the gap in reviewNotes
   instead):
   General Safety Warnings → Specific Hazard Warnings (electric shock, burns/hot surfaces, fire,
   sharp edges, choking/small parts, etc. — as many or as few as this product needs) → Symbols and
   Their Meaning (only if the draft references hazard/warning pictograms — emit each as an "image"
   block) → Correct Use reminders (short do's/don'ts only, NOT a full operating guide) → Disposal
   (only genuinely product-specific notes; the standard WEEE block is stripped per task 4).`;

function buildPrompt(kind: IMTemplateType, opts: ImImportPromptOptions = {}): string {
  const cat = opts.category?.trim() || '[[CATEGORY]]   (e.g. "Coffee Machines")';
  const langs = opts.languages?.trim() || '[[TARGET LANGUAGES]]   (e.g. en, de)';
  const existing = opts.existingTemplateExport?.trim() || '[[EXISTING TEMPLATE EXPORT]]';
  const isWl = kind === 'warning_leaflet';
  const docLabel = isWl ? 'leaflet' : 'chapter';
  const kindLine = isWl
    ? '"kind": "warning_leaflet",'
    : '"kind": "im",';

  const header = isWl ? WL_INTENT : IM_INTENT;
  const context = (isWl ? WL_CONTEXT : IM_CONTEXT)(cat, langs, existing);
  const structureTask = isWl ? WL_STRUCTURE_TASK : IM_STRUCTURE_TASK;

  return `${header}

${context}

YOUR TASKS
1. REVIEW & CORRECT the draft: fix factual contradictions, unclear steps, wrong terminology, and
   inconsistent structure. Improve clarity and tone for an end user.
2. NEVER INVENT technical facts. If a spec, dimension, rating, or instruction is missing or
   ambiguous, do NOT guess — add it to reviewNotes.openQuestions instead.
${structureTask}
4. STRIP STANDARDIZED BOILERPLATE (company info/imprint, WEEE symbol & generic disposal text,
   generic conformity declarations, marketing blurb) and record each removed item as a short
   string in excludedStandardized. In the Disposal chapter, keep only genuinely product-specific
   notes (e.g. packaging separation), NOT the standard WEEE block.
${CALLOUT_MAPPING}
6. SPECIFY NEEDED IMAGES. You cannot create images. Wherever a figure is needed${isWl ? ' (a hazard/warning pictogram, a symbol legend)' : ' (parts diagram, assembly step, control layout, etc.)'},
   emit an "image" block with an "imageNeed" object that precisely describes the required image,
   its purpose, any callout-number annotations, and where in the supplier draft it might come
   from. Leave its "content" maps empty ("").
7. TRANSLATE all human-readable text into every target language. Keep "en" (source) always
   present. If you are unsure of a technical translation, keep the source-language text and note
   it in reviewNotes.openQuestions rather than guessing.
${SCOPE_TASK(docLabel)}
${DIFF_TASK}

${GROUPING_AND_HTML_RULES}

OUTPUT
- Output ONE valid JSON document and NOTHING else — no explanation, no markdown fences, no prose
  before or after. It must parse with JSON.parse.
- Conform exactly to the schema below.

SCHEMA (OriginFlow IM Import v1)
{
  "importSchemaVersion": 1,
  ${kindLine}
  "category": "<the category above>",
  "product": { "name": "…", "sku": "…", "supplier": "…" },
  "languages": ["en", "…"],
  "sourceLanguage": "en",
  "cover": { "title": { "en": "…" }, "imageNeed": { … } },   // optional
  "sections": [
    {
      "key": "${isWl ? 'general-warnings' : 'safety'}",               // unique slug within the file
      "parentKey": null,             // another section's key for nesting, or null
      "order": 1,
      "title": { "en": "…" },        // language map
      "scope": "generic",            // optional: "generic" (default) | "model-specific"
      "matchStatus": "new",          // optional: "new" (default) | "matches-template" | "adjust-template"
      "matchedSectionKey": null,     // required if matchStatus is matches-template/adjust-template
      "blocks": [
${BLOCK_SHAPES}
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

${isWl ? WORKED_FRAGMENT_WL : WORKED_FRAGMENT_IM}

Now wait for the supplier draft in my next message, then produce the JSON.`;
}

const WORKED_FRAGMENT_IM = `WORKED FRAGMENT (illustrates the exact shape — your full output covers all chapters)
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
      "key": "specs", "parentKey": null, "order": 8,
      "title": { "en": "Technical Specifications", "de": "Technische Daten" },
      "scope": "model-specific",
      "blocks": [
        { "type": "table", "scope": "model-specific",
          "content": { "en": "<table class=\\"im-table\\"><thead><tr><th>Spec</th><th>Value</th></tr></thead><tbody><tr><td>Rated power</td><td>1450 W</td></tr></tbody></table>" } }
      ]
    },
    {
      "key": "intended-use", "parentKey": null, "order": 1,
      "title": { "en": "Intended Use", "de": "Bestimmungsgemäße Verwendung" },
      "matchStatus": "matches-template", "matchedSectionKey": "9f3a1c2b-0000-4d21-8e77-…",
      "blocks": []
    }
  ],
  "excludedStandardized": ["WEEE disposal block", "company imprint", "generic CE declaration"],
  "reviewNotes": {
    "corrections": ["Fixed descaling interval contradiction (2 vs 3 months)."],
    "additionsSuggested": ["Added missing Intended Use chapter."],
    "deletions": ["Removed marketing copy from safety section."],
    "openQuestions": ["Rated power not stated in draft — confirm with supplier."]
  }
}`;

const WORKED_FRAGMENT_WL = `WORKED FRAGMENT (illustrates the exact shape — your full output covers every warning chapter)
{
  "importSchemaVersion": 1,
  "kind": "warning_leaflet",
  "category": "Coffee Machines",
  "product": { "name": "BrewMaster 500", "sku": "KL-BM500", "supplier": "Homelux" },
  "languages": ["en", "de"],
  "sourceLanguage": "en",
  "sections": [
    {
      "key": "general-warnings", "parentKey": null, "order": 1,
      "title": { "en": "General Safety Warnings", "de": "Allgemeine Sicherheitshinweise" },
      "blocks": [
        { "type": "callout", "variant": "warning",
          "content": {
            "en": "<p>Read all warnings before use. Keep this leaflet for future reference.</p>",
            "de": "<p>Lesen Sie vor Gebrauch alle Warnhinweise. Bewahren Sie dieses Merkblatt auf.</p>" } },
        { "type": "callout", "variant": "info",
          "content": {
            "en": "<p>Keep out of reach of children.</p>",
            "de": "<p>Von Kindern fernhalten.</p>" } }
      ]
    },
    {
      "key": "electric-hazard", "parentKey": null, "order": 2,
      "title": { "en": "Electric Shock Hazard", "de": "Stromschlaggefahr" },
      "blocks": [
        { "type": "callout", "variant": "electric",
          "content": {
            "en": "<p>Do not immerse the base, cord, or plug in water. Risk of electric shock.</p>",
            "de": "<p>Sockel, Kabel oder Stecker nicht in Wasser tauchen. Stromschlaggefahr.</p>" } }
      ]
    },
    {
      "key": "symbols", "parentKey": null, "order": 3,
      "title": { "en": "Symbols Used", "de": "Verwendete Symbole" },
      "blocks": [
        { "type": "image",
          "imageNeed": { "description": "Hot-surface warning pictogram (ISO 7010 W017) as printed on the leaflet",
                         "purpose": "symbol legend", "annotations": [],
                         "suggestedSource": "supplier PDF back page, symbol key" },
          "content": { "en": "", "de": "" } }
      ]
    }
  ],
  "excludedStandardized": ["WEEE disposal block", "company imprint", "generic CE declaration"],
  "reviewNotes": {
    "corrections": ["Draft mixed a full operating step into the safety section — moved out; leaflet keeps only the warning."],
    "additionsSuggested": ["Added an Electric Shock Hazard chapter — draft only had one buried sentence."],
    "deletions": [],
    "openQuestions": ["Draft did not specify a max surface temperature for the hot-surface warning — confirm with supplier."]
  }
}`;

export function buildImImportPrompt(kind: IMTemplateType, opts?: ImImportPromptOptions): string {
  return buildPrompt(kind, opts);
}
