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
2. (Optional) Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in [.env.local](.env.local) for live Supabase data
3. (Optional) For AI features, set `GEMINI_API_KEY` — **server-side, no `VITE_` prefix**. It is read by the
   Netlify Function proxy ([netlify/functions/gemini.ts](netlify/functions/gemini.ts)) and never shipped to the browser.
4. Run the app:
   - `npm start` — Vite dev server (everything except AI works)
   - `npx netlify dev` — use this instead if you want the AI features to work locally (serves the Gemini proxy function)

Build with `npm run build`; run tests with `npm test`.

## Service Layer Conventions

The legacy `apiService.ts` monolith has been **removed** — all service logic now lives in domain
modules. When adding or refactoring service calls:

- Import services from `src/services/index.ts` (the barrel) or directly from a domain module.
- Add new CRUD logic in the domain-specific file (e.g., `src/services/project/*`) and export it via
  `src/services/index.ts`.
- Use the `runMutation` / `runQuery` helpers in `src/services/core/db.ts` for the standard
  "throw on Supabase error" pattern instead of repeating `if (error) handleError(...)`.
- Keep snake_case↔camelCase mapping in `src/utils/mappers.utils.ts` (the single source of truth).
