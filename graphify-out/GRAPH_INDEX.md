# Graph Index

6165 nodes · 15419 edges · 398 communities · 766 files · built at `d9bf54a848e5`

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

## Communities (top 30 of 398)

- `0` **live-browser.js** — 108 nodes · .agents/skills/impeccable/scripts
- `87` **App.tsx** — 105 nodes · src/components, src/context
- `72` **doc-access.ts** — 94 nodes · netlify/functions/lib, netlify/functions
- `9` **live-server.mjs** — 94 nodes · .agents/skills/impeccable/scripts
- `76` **im-tm-translate.ts** — 86 nodes · src/services/im, src/pages/im
- `2` **im-viewer/types.ts** — 83 nodes · src/modules/im-viewer, src/services/im
- `92` **render-print-merge.ts** — 82 nodes · netlify/functions, netlify/functions/lib
- `126` **utils/index.ts** — 78 nodes · src/utils, src/services/project
- `148` **im-translation-import.service.ts** — 76 nodes · src/services/im, src/pages/im/project-im-generator
- `151` **im/index.ts** — 76 nodes · src/services/im, src/pages/im
- `21` **InlineBlockEditor.tsx** — 76 nodes · src/pages/im/editor, src/services/im
- `90` **ProjectIMGenerator.tsx** — 73 nodes · src/pages/im/project-im-generator, src/services/im
- `1` **im-print-html.ts** — 70 nodes · src/services/im, src/utils
- `129` **project/index.ts** — 70 nodes · src/services/project, src/utils
- `28` **data/index.ts** — 70 nodes · src/services/ai, src/services/regulatory
- `13` **checks.mjs** — 69 nodes · .agents/skills/impeccable/scripts/detector/rules, .agents/skills/impeccable/scripts/detector/shared
- `8` **resumeSession** — 69 nodes · .agents/skills/impeccable/scripts
- `117` **src/types.ts** — 66 nodes · src/components/products/attribute-grid, src/components/products
- `321` **types/index.ts** — 65 nodes · src/types
- `14` **handleClick** — 59 nodes · .agents/skills/impeccable/scripts
- `10` **projects table** — 59 nodes · ., docs
- `22` **PlaceholderIntakeWizard.tsx** — 58 nodes · src/pages/im/project-im-wizard, src/pages/im/project-im-generator
- `41` **translation.service.ts** — 58 nodes · src/services/ai, src/services/im
- `11` **index.mjs** — 58 nodes · .agents/skills/impeccable/scripts/detector/browser/injected
- `6` **services/index.ts** — 57 nodes · src/services/project, src/pages
- `16` **modern-screenshot.umd.js** — 57 nodes · .agents/skills/impeccable/scripts
- `40` **im-publish.service.ts** — 55 nodes · src/services/im, src/data
- `19` **pm-inbox.service.ts** — 50 nodes · src/services/shared, src/components/inbox
- `3` **live-commit-manual-edits.mjs** — 50 nodes · .agents/skills/impeccable/scripts
- `303` **IMTemplateEditor.tsx** — 49 nodes · src/pages/im/editor, src/pages/im

368 smaller communities ([object Object] nodes and under) are left out on purpose —
`node scripts/graph-query.mjs communities` lists all of them.

## Core abstractions (most connected)

- `live-browser.js` — 429 edges · .agents/skills/impeccable/scripts/live-browser.js
- `im/index.ts` — 222 edges · src/services/im/index.ts
- `src/types.ts` — 205 edges · src/types.ts
- `types/index.ts` — 184 edges · src/types/index.ts
- `services/index.ts` — 165 edges · src/services/index.ts
- `ProjectIMGenerator.tsx` — 155 edges · src/pages/im/ProjectIMGenerator.tsx
- `detect-antipatterns-browser.js` — 138 edges · .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- `regulatory/index.ts` — 123 edges · src/services/regulatory/index.ts
- `InlineBlockEditor.tsx` — 123 edges · src/pages/im/editor/InlineBlockEditor.tsx
- `live-server.mjs` — 120 edges · .agents/skills/impeccable/scripts/live-server.mjs
- `project/index.ts` — 109 edges · src/services/project/index.ts
- `im-print-html.ts` — 103 edges · src/services/im/im-print-html.ts
