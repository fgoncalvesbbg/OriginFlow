# Regulation research → import

Getting a regulation into OriginFlow's library without typing it in by hand.

## The loop

1. **Copy the prompt.** Regulations → **Import** → *Copy prompt*. Its canonical text lives in
   [src/pages/regulations/research-prompt.ts](../../src/pages/regulations/research-prompt.ts) —
   that file is the single source of truth, so there is no second copy here to drift from it.
2. **Run it in an AI with web search**, with the standard (or extracts, supplier declarations,
   competitor manuals) attached. Fill the four `<<< … >>>` placeholders first.
3. **You get two artefacts**: an `OriginFlow Regulation Import v1` JSON, and a Markdown
   dossier. The JSON goes into the app; the dossier is the human record.
4. **Paste the JSON** into Regulations → Import. It is validated and previewed. Nothing is
   written until you press Import.

## Why the JSON is validated so harshly

The document is produced by a model, and a model asked about a standard it cannot see will
produce a confident, well-formed, wrong clause number. A compliance library full of plausible
fiction is worse than an empty one, so
[regulation-import.service.ts](../../src/services/regulatory/regulation-import.service.ts)
refuses rather than repairs. Four rules do most of the work:

| Rule | Why |
|---|---|
| Unknown carrier values are **errors**, not dropped | `"IM "` vs `"IM"` is invisible in a diff and decides whether an obligation ever reaches a manual's checklist |
| Every `obligations[].clause` must exist in `clauses[]` | A dangling citation is the signature of an invented one |
| `verbatim` requires `sourceQuoted: true` | This is text a translation must preserve byte-for-byte; wording a model *composed* is worse than none |
| `status: "expired"` needs a separate tick in the dialog | Expiry blocks every manual and new TCF request citing the regulation. A paste must not be able to do that |

Every error message names the exact field, so the list can be pasted straight back to the
researcher.

## Merge semantics

Matching mirrors the database's own uniqueness, so re-importing is a no-op rather than a mess:

- a **regulation** by `referenceCode`, case- and whitespace-insensitively (same rule as
  `uq_regulations_reference_code`)
- a **clause** by `number` within that regulation
- an **obligation** by exact `text`

**Nothing is ever deleted by an import.** A second research pass mentioning fewer obligations
is not evidence that the missing ones stopped existing. Categories are *merged*, never
replaced — an import must not silently un-apply a regulation from a category someone ticked by
hand.

## The two artefacts, and why they are separate

`summaryMd` inside the JSON is **regulatory content only**. It becomes
`regulations.summary_md`, which is the one and only thing the AI regulatory check is told
about the regulation — so market research and competitor commentary must stay out of it, or a
compliance judgement starts leaning on speculation about what a competitor does.

The Markdown dossier is the opposite: everything you found, including transcripts, worked
examples, competitor wording, RAPEX notifications and open questions. Nothing reads it
automatically; it exists so a person can audit the import a year later.

## TCF requirements

`tcfRequirements[]` are **not** imported automatically, because a TCF requirement belongs to
one category and the document cannot know which. The dialog asks. A requirement whose title
already exists in the chosen category is skipped.

## Fields

The full field list with types and the enforced enums is in the prompt itself (section 3) —
kept there rather than duplicated here, since that is the copy the researcher actually reads.
The shape is checked against these tables:

- `regulations` — [db_migrations/139](../../db_migrations/139_regulation_brain.sql),
  [140](../../db_migrations/140_regulation_expiry.sql)
- `regulation_clauses`, `regulation_obligations` —
  [db_migrations/141](../../db_migrations/141_regulation_clauses.sql)
- `compliance_requirements.regulation_id` / `.clause_id` — 139 and 141

See [example.import.json](example.import.json) for a complete, valid document.
