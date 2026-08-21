# regulatory-check (Supabase Edge Function)

Audits one chunk of one English IM template against one regulation, and returns structured
findings. Called by `src/services/regulatory/regulatory-check.service.ts`, once per
(regulation × chunk).

## Why this is here and not in `netlify/functions`

Everything else server-side in this repo is a Netlify function. This one cannot be. A
synchronous Netlify invocation is capped at **10 s by default** and ~26 s at best — the same
limit documented in `netlify/functions/lib/print-render-shared.ts`, which is why the print
pipeline is split into `prepare`/`part`/`merge`. One `claude-opus-5` call with extended
thinking over a regulation summary fits in neither number, and unlike a PDF part a single
reasoning call cannot be subdivided until it does. The first real run — 8 regulations × 2
chunks — failed all 16 units with a bodyless HTTP 502, the gateway reporting invocations it
had killed.

A Supabase Edge Function has a wall-clock budget in the low hundreds of seconds, and time
spent awaiting the Anthropic API is not CPU time, so the tight CPU allowance does not apply
to a function that is almost entirely one `await`. That keeps the design as plain
request/response — no background queue, no staging table, no polling.

## Deploy

Requires the Supabase CLI (`npm i -g supabase` or `npx supabase`).

```bash
# once, to link this working copy to the project
supabase link --project-ref <project-ref>

# the Anthropic key (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically)
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...

# deploy
supabase functions deploy regulatory-check
```

Run it locally instead with `supabase functions serve regulatory-check`, which reads the
key from `supabase/.env.local`.

## Notes

- The function is **not** typechecked by the app's `tsc`: `tsconfig.json` excludes
  `supabase/`, because Deno globals and `npm:` specifiers do not resolve in the app project.
  The CLI typechecks it on deploy.
- The system prompt lives in the `ai_prompts` table (key `im_regulatory_check`) so admins
  can tune the judgement rules without redeploying. The hardcoded `FALLBACK_SYSTEM_TEMPLATE`
  is kept byte-identical to the seed in `db_migrations/115_create_regulation_library.sql`.
- The model is pinned server-side and never read from the request body, so the endpoint
  cannot be used as an open LLM relay.
- The regulation and its summary are read here, not uploaded by the browser. That is also
  the authorization check: the regulation must either be explicitly assigned to the
  template or be an active regulation whose `applicable_categories` contains the template's
  `category_id`.
