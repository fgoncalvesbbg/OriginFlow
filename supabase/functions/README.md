# Supabase Edge Functions

Three edge functions are ACTIVE in project `ecueltibpmpnhnaxlskx`. Until 2026-09-08 only
one of them had source in this repo; the other two existed **only** as deployed artifacts
and were one bad deploy away from being lost. They were recovered via the Supabase
Management API and are archived here.

| Directory (= deploy slug) | Display name | Version | Reachable from the app? | State |
| --- | --- | --- | --- | --- |
| `regulatory-check/` | `regulatory-check` | 3 | **yes** — `src/services/regulatory/regulatory-check.service.ts` | live, in use |
| `send-tcf-notification/` | `send-tcf-notification` | 6 | no | live but **dead** |
| `smooth-responder/` | `send-submission-email` | 9 | no | live but **dead + superseded** |

All three have `verify_jwt = true` in production.

## The two email functions are dead

`triggerEmailNotification` in `src/services/shared/notification.service.ts` is a stub:

```ts
console.info("Email notification suppressed per project settings.", payload.type);
return { success: true, message: "Email suppressed" };
```

It suppresses every send and reports success. Nothing else in `src/` or
`netlify/functions/` invokes either email endpoint, so both are unreachable from the
application while still being publicly deployed and holding secrets
(`RESEND_API_KEY`, `FROM_EMAIL`, `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`).

`smooth-responder` is additionally the *predecessor* of `send-tcf-notification` — same job
over raw SMTP instead of the Resend HTTP API. Its successor's own comment ("No broken SMTP
libraries needed!") records why it was replaced. Its SMTP import is unpinned
(`deno.land/x/smtp/mod.ts`), so a redeploy would pull whatever is latest.

**Recommended:** delete both from production and drop their secrets. Nothing calls them,
and they are attack surface with no purpose. They stay archived here either way, so
deletion loses nothing. Not done yet — needs a decision.

If email is ever wanted for real, `send-tcf-notification/index.ts` is the one to revive:
implement the stub in `notification.service.ts` to invoke it, and pin its imports.

## Faithfulness notes

Both recovered files reproduce the deployed artifact, with a header comment added
explaining provenance. Two quirks preserved deliberately:

- `smooth-responder/`'s entrypoint really is `send-tcf-notification.ts`, not `index.ts`,
  and its slug really does not match its display name or its code's name. The layout here
  mirrors the deployment so a redeploy would behave identically.
- `send-tcf-notification/index.ts` carries a `--no-verify-jwt` deploy comment, but the
  deployed function has `verify_jwt = true`. The comment is wrong; the deployment is what
  matters.

Line endings were normalised from CRLF to LF. Code is otherwise byte-identical.

## Redeploying (e.g. for a new tenant project)

```bash
supabase functions deploy regulatory-check --project-ref <new-ref>
```

Secrets do not transfer between projects — re-set them with `supabase secrets set`.
Per `docs/MULTI_TENANCY.md` step 5, a new tenant needs `regulatory-check` only; do not
carry the two dead email functions forward.
