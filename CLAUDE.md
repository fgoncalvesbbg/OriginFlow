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
