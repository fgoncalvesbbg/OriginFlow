# Future idea: in-app, automatic supplier-draft diff import

**Status: not built. This is a deliberately deferred idea, captured here so it isn't lost or
re-invented from scratch later.** The shipped feature today (see
[`schema.md`](./schema.md#diffing-against-an-existing-template) and `review-prompt.md`) is
chat-based: a human runs the review prompt in Claude Chat, pastes the JSON back into the app.
This doc describes the natural next step — doing the same thing automatically, in-app — and why
it wasn't built now.

## The idea

Wrap the exact same schema and review-prompt logic in a server-side call so a PM never leaves the
app:

1. Supplier PDF → `src/modules/pdf-to-markdown` (already built, already wired in at
   `/tools/pdf-to-markdown`) → clean Markdown.
2. The project's currently-bound template → `exportTemplateForReview(templateId)` (already built,
   see `im-import.service.ts`).
3. Both feed a new Netlify Function, modeled directly on the existing
   `netlify/functions/translate.ts`: an `@anthropic-ai/sdk` call whose system prompt is the
   `review-prompt.md` content, sourced from the `ai_prompts` Supabase table (same pattern as
   `translate.ts`, editable without a redeploy) rather than hardcoded.
4. The function returns `OriginFlow IM Import v1` JSON with `matchStatus`/`matchedSectionKey`
   already filled in — same shape a human would get back from Claude Chat.
5. That JSON is validated (`validateImImport`, already built) and shown in a review UI —
   **do not skip this step**; committing an AI-classified diff without a human glance at
   `reviewNotes.openQuestions` and the matched/new/adjusted breakdown is how a wrong
   `matches-template` call silently drops real content.
6. On confirm, the existing `importSupplierDraftIntoProject` (already built) commits it —
   no new import/merge logic needed; this reuses the exact function the chat-based flow uses.

In short: steps 1, 2, 5 (validation), and 6 are already built. The only new piece is step 3 (the
server-side AI call) plus a slightly richer review UI that runs the export → call → validate
sequence automatically instead of asking the user to copy/paste through Claude Chat.

## Why this is deferred, not rejected

- **Cost.** Every import becomes a metered `ANTHROPIC_API_KEY` call charged to the app, versus
  today's cost, which is borne by whoever runs the chat (their own Claude subscription/usage). For
  occasional supplier-draft imports, chat-based is simply cheaper — this was an explicit tradeoff
  the user identified and chose to keep for now.
- **No new diffing logic to write.** The generic/model-specific and matches-template/
  adjust-template/new classification is a semantic judgment call an LLM makes well and a bespoke
  string-diff algorithm would not — don't build a custom comparison engine here even when this is
  automated; keep delegating the judgment to the model, same as today.
- **Needs a review step regardless.** Full automation without a human checkpoint before commit is
  riskier than the current flow, where a person necessarily reads the JSON before pasting it in.
  Any in-app version should keep an explicit "review before commit" screen, not silently apply the
  AI's output.

## When to revisit

- Copy/paste between Claude Chat and the app becomes a real bottleneck (frequent imports, several
  people doing this regularly).
- Import volume grows enough that the metered API cost is clearly worth the time saved.

When that happens, build step 3 above and slot it into the existing
`ProjectSupplierDiffImportDialog.tsx` flow (`src/pages/im/`) as an alternative to the manual
export/copy/paste steps — the validate → review → commit steps already there don't need to change.
