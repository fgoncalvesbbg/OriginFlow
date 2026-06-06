# Structural Cleanup — Change Summary

Branch: `cleanup/structural-review`. Companion to [AUDIT_REPORT.md](AUDIT_REPORT.md).
All changes verified: `tsc --noEmit` clean, 46/46 vitest tests pass, `vite build` succeeds.

The in-flight work that was uncommitted at the start was snapshotted first (commit `6e6d5cf`) so this
cleanup is an isolated, reviewable diff on top of it.

## Commits

1. **`6e6d5cf` Snapshot in-flight work** — committed the pre-existing uncommitted changes untouched.
2. **`0e9a080` Phase 2 safe wins** — bug/security fixes + dead-code removal.
3. **`<this commit>` Phase 2b + Phase 3** — God-file decomposition, ConfirmationModal consolidation, file headers, docs.

## Phase 2 — Safe fixes

### Bugs: silent DB-write failures (11 sites)
Added each file's existing `if (error) handleError(...)` guard to writes that previously swallowed
errors. ⚠️ Behavior note: these now surface errors instead of failing silently — the intended
behavior (every sibling function already did this).
- `im-section.service.ts` (deleteIMSection), `compliance-requirement.service.ts` (deleteRequirement, deleteCategoryAttribute)
- `compliance.service.ts` (submitComplianceResponse), `compliance-category.service.ts` (deleteCategory, deleteProductFeature)
- `project-document.service.ts` (removeDocument, deleteDocumentVersion)
- `notification.service.ts` (markNotificationRead), `profile.service.ts` (updateUserRole)
- `supplier.service.ts` (assignSupplierToPMs delete step)

### Security: HTML sanitization
- Added `src/utils/sanitize-html.utils.ts` (`sanitizeHtml`, DOMPurify — already a dependency).
- Applied to 6 DB-sourced `dangerouslySetInnerHTML` sites in IMPreview, IMBlockLibrary, and ProjectIMGenerator.
- The customer-facing `src/modules/im-viewer` already sanitized; config mirrors it.

### Security: code generation
- Added `src/utils/code.utils.ts` (`generateNumericCode`, crypto-backed).
- Replaced `Math.random()` access/RFQ codes in `compliance.service.ts`, `supplier.service.ts`, `supplier-proposal.service.ts`.
- Folded a duplicated private `generateUUID` in `supplier-proposal.service.ts` into the canonical crypto-backed `utils/uuid.utils.ts`.

### Dead code
- Deleted `src/services/apiService.ts` (1,814 LOC) — `@deprecated`, **verified zero importers**, not in the services barrel. This also removed 8 drifted duplicate mappers, a duplicate `handleError`, and a duplicate `COMPLIANCE_SECTIONS`.
- Removed `resolveSectionLayout` from ProjectIMGenerator (defined, never used; `noUnusedLocals` is off so tsc never flagged it).

## Phase 2b — God-file decomposition

- Extracted from `ProjectIMGenerator.tsx` (2,690 → 2,480) into `src/pages/im/project-im-generator/`:
  `BindableField.tsx`, `AddProjectSection.tsx`, `im-layout.utils.ts` (DEFAULT_MASTER_PAGES, getBackgroundStyle, joinAttrValues). Pruned now-unused icon imports.
- **Consolidated 3 duplicated `ConfirmationModal` copies** (ProjectDetail, IMTemplateEditor, ProjectIMGenerator) into `src/components/common/ConfirmationModal.tsx`. A `variant` prop (`primary`→"Confirm" / `danger`→"Delete") reproduces each call site's exact button, so rendering is unchanged.

> Note: these files remain large because most logic is inside stateful component bodies. Restructuring
> that risks behavior changes, so per the brief it was left in place — see "Recommended follow-ups".

## Phase 3 — Documentation

- Added concise file-header comments to the **47** source files that had none (entry points, pages, components, hooks, services, utils).
- Added `AUDIT_REPORT.md` (full findings) and this `CHANGES.md`.
- Per request, inline `// [CHANGED]` markers were intentionally **not** used (see git history for the diff instead).

## Follow-ups — status

Implemented after the initial cleanup (separate commits on this branch):

- ✅ 🔴 **Gemini API key moved server-side** — Netlify Function proxy (`netlify/functions/gemini.ts`) + client (`src/services/ai/gemini.client.ts`); all client-side `VITE_GEMINI_API_KEY`/`GoogleGenAI` usage removed. **Deploy action:** set `GEMINI_API_KEY` (server-only) in Netlify env.
- ✅ 🟠 **Service query wrapper** — `src/services/core/db.ts` (`runMutation`/`runQuery`); 24 mutations + 3 reads adopted it. Intentional swallow-and-fallback reads left explicit.
- ◑ 🟠 **God-file decomposition** — pure, args-only helpers extracted from ProjectIMGenerator (`im-content.utils.ts`, `im-layout.utils.ts`) and subcomponents (`BindableField`, `AddProjectSection`). The remaining bulk of ProjectIMGenerator/ProjectDetail/IMTemplateEditor/SupplierDashboard is stateful component logic; extracting it (custom hooks) risks behavior changes and needs runtime testing — **deferred**.
- ✅ 🟡 **ConfirmationModal** — folded AdminDashboard's copy (4th) into the shared `components/common/ConfirmationModal.tsx`.
- ✅ 🟡 **File naming** — already consistent after `apiService.ts` removal (all `*.service.ts` / kebab domain files / `*.client.ts`); no risky renames performed.

Still open (need a runtime-testing pass / product input):
- Deeper stateful decomposition of the four large pages into hooks/subcomponents.
- Local-dev note: AI features require `netlify dev` (the proxy isn't served by plain `vite`).
