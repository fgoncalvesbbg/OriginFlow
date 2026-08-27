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
