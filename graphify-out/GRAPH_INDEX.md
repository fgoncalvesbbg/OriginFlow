# Graph Index

2902 nodes · 8750 edges · 111 communities · 313 files · built at `b876c0669e7e`

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

## Communities (top 30 of 111)

- `0` **Live Browser Design Builder** — 105 nodes · .agents/skills/impeccable/scripts
- `1` **IM Print/PDF Rendering** — 87 nodes · src/services/im, netlify/functions/lib
- `2` **IM Viewer & HTML Sanitization** — 83 nodes · src/modules/im-viewer, .
- `3` **Live Manual-Edit Commit** — 83 nodes · .agents/skills/impeccable/scripts
- `4` **Project IM Content Editor** — 68 nodes · src/types, src/services/im
- `5` **App Shell & Routing** — 66 nodes · src/components, src/services/supplier
- `6` **Status Badge System** — 66 nodes · src/services/project, src/types
- `7` **Admin & Compliance Library** — 63 nodes · src/services/compliance, src/services/ai
- `8` **Live Svelte Insert Session** — 61 nodes · .agents/skills/impeccable/scripts
- `9` **Live Server Manual-Apply** — 60 nodes · .agents/skills/impeccable/scripts
- `10` **DB Schema & PM RLS Policies** — 59 nodes · ., docs
- `11` **Visual Contrast Analysis** — 58 nodes · .agents/skills/impeccable/scripts/detector/browser/injected
- `12` **Translation Service** — 58 nodes · src/services/im, src/services/ai
- `13` **Layout/Border Checks** — 56 nodes · .agents/skills/impeccable/scripts/detector/rules, .agents/skills/impeccable/scripts/detector/shared
- `14` **Live Svelte Component Injection** — 55 nodes · .agents/skills/impeccable/scripts
- `15` **SKU Catalog** — 54 nodes · src/utils, src/services/project
- `16` **Screenshot Library (vendor)** — 53 nodes · .agents/skills/impeccable/scripts
- `17` **IM Dashboard** — 53 nodes · src/services/im, src/pages/im
- `18` **Live Page-Chat & Voice** — 49 nodes · .agents/skills/impeccable/scripts
- `19` **IM Block Library** — 47 nodes · src/services/im, src/pages/im
- `20` **Live Svelte Component Build** — 45 nodes · .agents/skills/impeccable/scripts
- `21` **Attribute Inputs & Block Editor** — 45 nodes · src/pages/im/editor, src/services/im
- `22` **IM Shared UI & Languages** — 45 nodes · src/pages/im, src/config
- `23` **Skill Docs: Caveman/Impeccable** — 42 nodes · .agents/skills/impeccable/reference, .agents/skills/impeccable
- `24` **Live Design Panel UI** — 40 nodes · .agents/skills/impeccable/scripts
- `25` **Supplier RFQ Portal** — 40 nodes · src/services/sourcing, src/types
- `26` **IM Viewer & Export Dialogs** — 40 nodes · src/services/im, src/pages/im
- `27` **Live Insert CLI** — 38 nodes · .agents/skills/impeccable/scripts, .agents/skills/impeccable/scripts/detector/engines/static-html
- `28` **App Config & Supabase Client** — 38 nodes · src/services/shared, src/types
- `29` **SKU/Proposal/Compliance Forms** — 37 nodes · src/services/project, src/components/products

81 smaller communities ([object Object] nodes and under) are left out on purpose —
`node scripts/graph-query.mjs communities` lists all of them.

## Core abstractions (most connected)

- `live-browser.js` — 429 edges · .agents/skills/impeccable/scripts/live-browser.js
- `services/index.ts` — 252 edges · src/services/index.ts
- `detect-antipatterns-browser.js` — 138 edges · .agents/skills/impeccable/scripts/detector/detect-antipatterns-browser.js
- `live-server.mjs` — 120 edges · .agents/skills/impeccable/scripts/live-server.mjs
- `ProjectIMGenerator.tsx` — 112 edges · src/pages/im/ProjectIMGenerator.tsx
- `src/types.ts` — 99 edges · src/types.ts
- `checks.mjs` — 97 edges · .agents/skills/impeccable/scripts/detector/rules/checks.mjs
- `types/index.ts` — 90 edges · src/types/index.ts
- `IMTemplateEditor.tsx` — 81 edges · src/pages/im/IMTemplateEditor.tsx
- `im/index.ts` — 73 edges · src/services/im/index.ts
- `ProjectDetail.tsx` — 69 edges · src/pages/ProjectDetail.tsx
- `project/index.ts` — 64 edges · src/services/project/index.ts
