# OriginFlow — Structural Audit Report

**Date:** 2026-06-05
**Scope:** `src/` — 135 TS/TSX files, ~33k LOC. React + TypeScript + Vite + Supabase.
**Branch:** `cleanup/structural-review` (in-flight work snapshotted in commit `6e6d5cf` before any cleanup).

Severity legend: 🔴 Critical · 🟠 Important · 🟡 Minor.
Each finding notes a **confidence** level. Per a prior lesson, every "dead code" claim below was re-verified by grepping for references before being listed.

---

## Architecture summary

The codebase is **mid-migration** from a legacy monolith to per-domain services:

- **Legacy layer:** `src/services/apiService.ts` (1,814 lines) — marked `@deprecated` in its own header. ~100 functions spanning every domain. **Verified to have zero importers** anywhere in `src` and it is **not** re-exported by the `src/services/index.ts` barrel.
- **Modern layer:** per-domain folders `src/services/{project,compliance,im,supplier,sourcing,manufacturing,auth,shared}/*`, surfaced through the `src/services/index.ts` barrel. Pages import from the barrel; **no direct Supabase calls were found in `.tsx` files** — data access is properly delegated to services.
- **Shared utilities:** `src/utils/mappers.utils.ts` holds the canonical snake_case↔camelCase mappers; `src/utils/error.utils.ts` holds the canonical `handleError`. The legacy `apiService.ts` carries private *duplicates* of both.

The data layer is in good shape. The two structural problems are (1) the dead legacy monolith still on disk, and (2) a handful of UI "God components".

---

## 1. Dead code & waste

| # | Sev | Finding | Location | Confidence |
|---|-----|---------|----------|------------|
| 1.1 | 🔴 | **Entire `apiService.ts` is orphaned.** `@deprecated`, zero importers, not in the barrel. Its private duplicate mappers (`mapProject`, `mapComplianceRequest`, etc.) have also *drifted* from the canonical `mappers.utils.ts` versions (e.g. its `mapComplianceRequest` is missing `conditionAttributes`; its `mapProject` is missing `categoryId`) — so it is not just dead but a latent trap if anyone re-imports it. | `src/services/apiService.ts` (1–1814) | **High** |
| 1.2 | 🟡 | `useAuth` thin re-export wrapper, exported via `src/hooks/index.ts`. Harmless indirection. | `src/hooks/useAuth.ts` | Medium |
| 1.3 | 🟡 | `src/types.ts` back-compat re-export shim. Imports of `'../types'` resolve here vs. `src/types/index.ts` — verify before touching. | `src/types.ts` | Low |

> **Note:** removing `apiService.ts` is the single biggest dead-code win (−1,814 LOC). Its header frames it as an intentional compatibility layer, so it is removed deliberately (with re-verification) rather than assumed safe.

## 2. Duplication & redundancy

| # | Sev | Finding | Location | Confidence |
|---|-----|---------|----------|------------|
| 2.1 | 🟠 | 8 mapper functions duplicated between `apiService.ts` and the canonical `mappers.utils.ts` (~132 LOC). Resolved by deleting `apiService.ts` (1.1). | `apiService.ts:67–198` vs `utils/mappers.utils.ts` | High |
| 2.2 | 🟠 | `handleError` duplicated (env-message wording drifted). Resolved by 1.1; canonical stays in `utils/error.utils.ts`. | `apiService.ts:33–63` vs `utils/error.utils.ts:7` | High |
| 2.3 | 🟡 | `COMPLIANCE_SECTIONS` duplicated; canonical is `config/compliance.constants.ts`. Resolved by 1.1. | `apiService.ts:24–31` | High |
| 2.4 | 🟡 | Repeated `const { data, error } = await supabase…; if (error) handleError(…)` boilerplate across ~75 service call sites. A `runQuery`/`runMutation` wrapper would cut noise — **deferred** (touches every service; not a "safe win"). | all `src/services/*` | Medium |

## 3. Bugs & instability

| # | Sev | Finding | Location | Confidence |
|---|-----|---------|----------|------------|
| 3.1 | 🟠 | **Silent DB-write failures.** 11 `.delete()`/`.update()` calls in *active* services do not capture/check `error`, while sibling functions in the same files do. Failures are swallowed. (List below.) | see below | **High** |
| 3.2 | 🟠 | `dangerouslySetInnerHTML` used at 10 sites; DOMPurify is already a dependency but not consistently applied to DB-sourced HTML. | 10 `.tsx` sites | Medium |
| 3.3 | 🟡 | Access/verification codes generated with `Math.random()` (not cryptographically strong) in active services. | `compliance.service.ts:63`, `supplier.service.ts:72`, `sourcing/supplier-proposal.service.ts:103` | High |
| 3.4 | 🟡 | Best-effort launch-checklist seeding inserts without error checks — **intentional** (wrapped in try/catch with explanatory comment). Left as-is. | `project/project.service.ts:101,113` | High |

**3.1 — unguarded writes (to be fixed):**
- `services/im/im-section.service.ts:83` — delete `im_sections`
- `services/compliance/compliance-requirement.service.ts:60` — delete `compliance_requirements`
- `services/compliance/compliance-requirement.service.ts:152` — delete `category_attributes`
- `services/compliance/compliance.service.ts:134` — update `compliance_requests`
- `services/compliance/compliance-category.service.ts:71` — delete `categories_l3`
- `services/compliance/compliance-category.service.ts:109` — delete `product_features`
- `services/project/project-document.service.ts:77` — delete `project_documents`
- `services/project/project-document.service.ts:140` — delete `document_versions`
- `services/shared/notification.service.ts:56` — update `notifications`
- `services/auth/profile.service.ts:53` — update `profiles` (role)
- `services/supplier/supplier.service.ts:124` — delete `supplier_pm_assignments` (the following insert is already guarded)

> ⚠️ **Behavior note:** these functions return `Promise<void>` and currently never throw on DB error. Adding the file's existing `if (error) handleError(...)` convention converts *silent failure → surfaced error*. This is the intended behavior (every sibling already does it) and is a low-risk correctness fix, but it is technically observable, so it is called out here.

## 4. Complexity & readability

| # | Sev | Finding | Location | Confidence |
|---|-----|---------|----------|------------|
| 4.1 | 🟠 | **God component** — mixes form state (30+ hooks), preview/HTML building, JSON/XML export, PDF coordination, SKU editors, publish checklist. | `pages/im/ProjectIMGenerator.tsx` (2,690) | High |
| 4.2 | 🟠 | **God component** — projects, documents, suppliers, steps, milestones, SKUs, attribute requests in one file. | `pages/ProjectDetail.tsx` (2,447) | High |
| 4.3 | 🟠 | **God component** — section/block/metadata editing + live preview + client-side AI translation call. | `pages/im/IMTemplateEditor.tsx` (1,877) | High |
| 4.4 | 🟡 | Other large pages worth later attention. | `SupplierDashboard.tsx` (1,798), `AdminDashboard.tsx` (1,216) | High |
| 4.5 | 🟡 | Magic string prefixes (`cond_`, `refvis_`, `secvis_`, `__field_bindings`) encode logic in formData keys. | `ProjectIMGenerator.tsx` | Medium |

## 5. Architecture & structure

| # | Sev | Finding | Location | Confidence |
|---|-----|---------|----------|------------|
| 5.1 | 🟡 | Inconsistent file naming: `apiService.ts` (camelCase) vs `im-resolver.ts` / `*.service.ts` (kebab). Renames break imports — deferred. | `src/services/*` | High |
| 5.2 | 🔴/sec | `VITE_GEMINI_API_KEY` used **client-side** in 3 components — the key ships in the browser bundle. Proper fix is a server/edge proxy (architectural). Flagged, not auto-fixed. | `IMTemplateEditor.tsx:799`, `ComplianceLibrary.tsx:252`, `components/ProjectAICopilot.tsx:63` | High |
| 5.3 | 🟡 | No circular dependencies found in barrel spot-checks. | — | Medium |

---

## Execution plan (this branch)

**Phase 2 — applied now (safe wins):**
1. Guard the 11 unguarded writes (3.1) using each file's existing `handleError` convention.
2. Sanitize DB-sourced `dangerouslySetInnerHTML` with the already-present DOMPurify (3.2).
3. Replace `Math.random()` code generation with `crypto.getRandomValues()` (3.3).
4. Delete the orphaned `apiService.ts` after re-verifying zero importers (1.1 / 2.1–2.3).

**Phase 2b — God-file decomposition (4.1–4.3):** extract clearly-separable, low-risk units (pure helpers, self-contained subcomponents, custom hooks) without altering behavior.

**Phase 3 — docs:** file-header comments on files that lack any top-of-file doc; this report + a `CHANGES.md` summary.

**Flagged, NOT auto-changed (need product/architecture decisions):**
- 5.2 Gemini key client-side exposure (needs a backend proxy).
- 2.4 service query-wrapper refactor (touches all services).
- 5.1 file renames; 4.4 remaining large pages.
