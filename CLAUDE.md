# CLAUDE.md

## The code graph (graphify-out/)

There is a graphify code graph in [graphify-out/](graphify-out/). Use it through the
query script, never by reading the artifacts:

```
node scripts/graph-query.mjs help          # commands
node scripts/graph-query.mjs stale         # ALWAYS run this before trusting the graph
```

- [graphify-out/GRAPH_INDEX.md](graphify-out/GRAPH_INDEX.md) (~1k tokens) is the only
  graph file worth reading whole — it's the community map plus the query cheatsheet.
- `graph.json` (4.7MB), `graph.html` (3.7MB), `manifest.json` and `cache/` are denied
  reads in [.claude/settings.json](.claude/settings.json) and hidden from Grep by
  [graphify-out/.ignore](graphify-out/.ignore). Query them.
- `GRAPH_REPORT.md` is ~9k tokens of prose. Grep it for a name if you must; the same
  facts come out of `graph-query.mjs` for a fraction of that.
- The graph is a point-in-time snapshot. `stale` names the files whose edges have drifted
  and the files that were never graphed at all — a miss there means "not in the graph",
  not "no such dependency". Fall back to Grep for those.

### Keeping it fresh

`graphify` (PyPI `graphifyy`) is installed for the current user; `graphify.exe` lives in
`%APPDATA%\Python\Python314\Scripts`, which is on the user PATH.

The **structural** half maintains itself. `graphify hook install` has wired
`.git/hooks/post-commit` and `post-checkout`: after each commit the changed code files are
re-parsed (tree-sitter AST, no LLM, no API key) and `graph.json` is rebuilt in a detached
background process. `git commit` returns immediately; the rebuild logs to
`~/.cache/graphify-rebuild.log`. Commits that only touch `graphify-out/` are skipped, so
committing the refreshed graph does not retrigger a rebuild.

Because `graphify-out/` is tracked, a commit leaves the refreshed graph as an unstaged
change — commit it with your next change. `.gitattributes` registers a union merge driver
for `graph.json` so concurrent branches merge instead of conflicting.

What the hooks do **not** do:

- **Regenerate `GRAPH_INDEX.md`.** The hook rewrites `graph.json`, `graph.html` and
  `GRAPH_REPORT.md` only. `stale` now warns when the index is older than the graph:

  ```
  node scripts/graph-query.mjs index --write
  ```

- **Doc, image and Markdown changes.** These need the semantic pass, which is LLM-backed.
  The hook ignores them.
- **Name communities.** Semantic community labels are LLM-generated. Without that pass
  each rebuild renames clusters after their highest-degree file, so a community reads as
  `ProjectDetail.tsx` rather than "Project detail & services". Cluster *names* are
  therefore mechanical; cluster *membership* is real. `INFERRED` edges and the
  surprising-connections half of `GRAPH_REPORT.md` are likewise frozen at the July build.

To run the semantic pass, invoke the `/graphify .` skill in Claude Code (extraction runs
through assistant subagents — this is how the original build was made, hence no API key in
the repo). Headless alternative if a key is available:
`graphify extract . --backend anthropic`. Useful flags:

```
graphify update .                 # AST-only refresh, additive, free (what the hook runs)
graphify label . --missing-only   # name only new/placeholder communities (needs a backend)
graphify hook status              # confirm the hooks are still installed
```

SQL is indexed via the `graphifyy[sql]` extra — without it the 98 files in
[db_migrations/](db_migrations/) contribute nothing to the graph. If a rebuild starts
warning about `tree_sitter_sql`, reinstall with `pip install --user "graphifyy[sql]"`.

Do not run a forced code-only rebuild (`graphify extract . --code-only --force`) to fix
staleness: it drops the node count below the existing graph and discards the semantic
layer. `graphify update .` is the safe, additive path.

## The database schema — introspect, do not read migrations

**`db_migrations/` is a change log, not a schema definition.** Do not answer "does column X
exist" or "is table Y live" from it, and never assume a file there has been applied.

Read [db_migrations/STATUS.md](db_migrations/STATUS.md) before trusting anything in that
folder. Why it cannot be truth, all verified 2026-09-08:

- Numbered files start at **37** — nothing exists for 1–33, so the folder has never been
  able to rebuild the schema.
- **34, 35, 36 are `.txt`, not `.sql`**, and are silently skipped by any `*.sql` glob.
- **117 and 129 are missing.**
- **Prefix 132 is used by two different files** (`132_create_im_leaflet_issues.sql` and
  `132_im_review_comment_attachments.sql`), so their relative order is undefined.
- `69b_restrict_anon_document_reads.sql` is off-scheme;
  `seed_regulations_hobs_marking_guide.sql` is a seed, not a migration.
- `supabase_migrations.schema_migrations` holds **59 rows against 122 numbered files**, and
  only **8** of those rows carry a numeric prefix (58, 59, 60, 139, 140, 141, 144, 145).
  The other 51 are hand-typed names (`pm_inbox`, `category_tree_l1_l2`,
  `pt_sync_identity_and_usage`…) from changes applied via the dashboard SQL editor or MCP.
  **Applied-vs-pending cannot be derived from this table.**
- **Untracked in git does not mean unapplied** — 155–158 were live in production while
  sitting untracked in the working tree.

To find out what the schema actually is, introspect the live database (project
`ecueltibpmpnhnaxlskx`) via the Supabase MCP tools — `list_tables`, or `execute_sql`
against `information_schema` / `pg_policies`.

**The folder was fully reconciled on 2026-09-09: nothing in it is pending.** 107 files
applied, 6 deliberately superseded by later migrations, 15 whose effect (drops, revokes,
policy rewrites, seeds) cannot be judged by object existence. STATUS.md lists which is
which. Do not "catch up" on a migration here — check the database first.

Prose notes about applied status go stale within days, **including notes in this repo and
in Claude's own memory**. Migrations 123, 132, 154, 155, 157 and 159 were all recorded as
"NOT applied" as late as 2026-09-07 and are in fact applied. Do not add new
applied-status claims in prose — check the database and cite the object you found.

And do not infer a migration's effect from its filename.
`132_im_review_comment_attachments.sql` creates no table of that name — it adds an
`attachments` column to `im_review_comments`, and it is applied.
`139_regulation_brain.sql` and `145_retire_dead_auth_objects.sql` create tables in the
`private_archive` schema, so a `public`-only check reports them missing. Both are applied.

What the migration files *are* good for: the header comments explain why each change was
made, and that reasoning exists nowhere else. Read them for intent, not for state.

## Edge functions

Three edge functions are ACTIVE in production. Until 2026-09-08 only `regulatory-check`
had source in the repo; the other two were deployed-only and have now been recovered into
[supabase/functions/](supabase/functions/). Read
[supabase/functions/README.md](supabase/functions/README.md) — it records which are live,
which are dead, and the slug/name/entrypoint mismatches.

Both email functions (`send-tcf-notification`, `smooth-responder`) are **dead**:
`triggerEmailNotification` in `src/services/shared/notification.service.ts` is a stub that
suppresses every send and returns success, so no code path reaches them. Do not assume
OriginFlow sends email — it does not.

## Multi-tenancy

Multiple companies on OriginFlow is a decided-but-unimplemented design: one Supabase
project per company, one codebase, subdomain routing. Before touching
`src/data/supabase/client.ts`, the Netlify functions' service-role key handling, or
`src/config/moduleAccess.config.ts`, read
[docs/MULTI_TENANCY.md](docs/MULTI_TENANCY.md) — it records what was rejected (pooled
`org_id`, duplicated tables, per-company code forks) and why, plus the runbook for cloning
a Supabase project for a new tenant.
