<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1buDBiNMWeQPfX3MfF4WIsOooqCzmu4N4

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `VITE_GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. (Optional) Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` if you want live Supabase data
4. Run the app:
   `npm run dev`

## Service Migration Checklist (apiService ➜ domain services)

When adding or refactoring service calls, use this quick checklist to avoid reintroducing duplicate CRUD logic:

- [ ] Import services from `src/services/index.ts` (or domain modules), not `src/services/apiService.ts`.
- [ ] If a page still depends on a missing service export, add/re-export it in the relevant domain module first.
- [ ] Keep `apiService.ts` as compatibility-only; annotate any temporary duplicate methods as deprecated.
- [ ] After migration, verify no page imports `apiService.ts` (`rg "services/apiService" src/pages -n`).
- [ ] Prefer adding new CRUD logic in domain-specific files (e.g., `src/services/project/*`) and export via `src/services/index.ts`.
