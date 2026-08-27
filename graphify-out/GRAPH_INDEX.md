# Graph Index

4733 nodes · 12836 edges · 308 communities · 587 files · built at `81dd15a0bc0c`

Regenerate with `node scripts/graph-query.mjs index --write`. This is the whole-graph
view; anything more specific comes from a query, not from reading a bigger file.

## Query it

```
node scripts/graph-query.mjs file src/services/im/im-print-html.ts   # defines / reaches / reached-from
node scripts/graph-query.mjs node buildImPrintDocument               # one symbol + neighbours
node scripts/graph-query.mjs community "IM Print"                   # files + busiest symbols
node scripts/graph-query.mjs search print-settings                   # find a symbol or file
node scripts/graph-query.mjs path renderPart buildParts              # how two symbols connect
node scripts/graph-query.mjs stale                                   # what drifted since the build
```

Lists are capped at 25; `--limit N` / `--all` widen them. Never read `graph.json` (4.7MB),
`graph.html` (3.7MB), `manifest.json`, or `cache/` — query instead.

## Communities (top 30 of 308)

- `90` **ProjectIMGenerator.tsx** — 119 nodes · src/pages/im/project-im-generator, src/services/regulatory
- `0` **live-browser.js** — 108 nodes · .agents/skills/impeccable/scripts
- `17` **im/index.ts** — 106 nodes · src/services/im, src/pages/im
- `6` **ProjectDetail.tsx** — 98 nodes · src/services/project, src/types
- `5` **App.tsx** — 88 nodes · src/components, src/pages
- `3` **live-commit-manual-edits.mjs** — 82 nodes · .agents/skills/impeccable/scripts
- `2` **im-viewer/types.ts** — 81 nodes · src/modules/im-viewer, src/pages/im
- `51` **CategoryAttribute** — 81 nodes · src/services/compliance, src/pages/compliance
- `4` **types/index.ts** — 78 nodes · src/types, src/services/im
- `28` **src/types.ts** — 77 nodes · src/services/im, src/services/regulatory
- `21` **InlineBlockEditor.tsx** — 76 nodes · src/pages/im/editor, src/services/im
- `12` **im-translation-import.service.ts** — 69 nodes · src/services/im, src/pages/im/project-im-generator
- `13` **checks.mjs** — 69 nodes · .agents/skills/impeccable/scripts/detector/rules, .agents/skills/impeccable/scripts/detector/shared
- `8` **resumeSession** — 69 nodes · .agents/skills/impeccable/scripts
- `87` **regulatory-check.service.ts** — 66 nodes · src/services/regulatory, src/pages/im
- `15` **utils/index.ts** — 64 nodes · src/utils, src/services/project
- `1` **im-print-html.ts** — 59 nodes · src/services/im, src/config
- `14` **handleClick** — 59 nodes · .agents/skills/impeccable/scripts
- `10` **projects table** — 59 nodes · ., docs
- `41` **translation.service.ts** — 58 nodes · src/services/ai, src/services/im
- `54` **im-tm-lookup.service.ts** — 58 nodes · src/services/im, src/config
- `11` **index.mjs** — 58 nodes · .agents/skills/impeccable/scripts/detector/browser/injected
- `9` **live-server.mjs** — 58 nodes · .agents/skills/impeccable/scripts
- `92` **print-render-shared.ts** — 57 nodes · netlify/functions, netlify/functions/lib
- `16` **modern-screenshot.umd.js** — 57 nodes · .agents/skills/impeccable/scripts
- `59` **im-tm-types.ts** — 53 nodes · src/services/im
- `20` **live-svelte-component.mjs** — 48 nodes · .agents/skills/impeccable/scripts
- `35` **detect-html.mjs** — 48 nodes · .agents/skills/impeccable/scripts/detector/engines/regex, .agents/skills/impeccable/scripts/detector/profile
- `67` **PrintExportDialog.tsx** — 47 nodes · src/services/im, src/pages/im
- `120` **im-tm-write.service.ts** — 46 nodes · src/services/im, src/config

278 smaller communities ([object Object] nodes and under) are left out on purpose —
`node scripts/graph-query.mjs communities` lists all of them.

## Core abstractions (most connected)

- `live-browser.js` — 429 edges · .agents/skills/impeccable/scripts/live-browser.js
- `ProjectIMGenerator.tsx` — 221 edges · src/pages/im/ProjectIMGenerator.tsx
- `im/index.ts` — 212 edges · src/services/im/index.ts
- `src/types.ts` — 140 edges · src/types.ts
- `detect-antipatterns-browser.js` — 138 edges · .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- `IMTemplateEditor.tsx` — 127 edges · src/pages/im/IMTemplateEditor.tsx
- `live-server.mjs` — 120 edges · .agents/skills/impeccable/scripts/live-server.mjs
- `orEmpty()` — 116 edges · src/data/resilience.ts
- `types/index.ts` — 112 edges · src/types/index.ts
- `InlineBlockEditor.tsx` — 107 edges · src/pages/im/editor/InlineBlockEditor.tsx
- `checks.mjs` — 97 edges · .agents/skills/impeccable/scripts/detector/rules/checks.mjs
- `services/index.ts` — 96 edges · src/services/index.ts
