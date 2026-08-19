# OriginFlow — roles and jobs

**Status: seeded draft. Every `[Guessing]` line needs correcting by the product owner before the scores in any audit mean anything.** The audit is only as good as this file: frequency and stakes here drive the entire ranking. A wrong frequency turns a nuisance into a priority.

Fill the two columns that matter most and are hardest to infer from code: **how often** and **what they do today instead**.

---

## Roles

| Role | Who | Primary surface | Notes |
|---|---|---|---|
| Category PM (author) | PMs incl. Manoj | IM authoring, PIM validation, product data entry | Writes and corrects content per SKU / per category |
| Assembler / publisher | `[Guessing]` compliance-side owner | IM assembly, publish snapshot, market/locale selection | Author/assembler boundary is a deliberate design decision |
| Process owner | Anabelle | Process, templates, handoff states, QA of others' output | Cares about repeatability and audit trail |
| Team lead | Nicolas | Workload visibility, throughput, review queues | Needs status across people, not per-SKU detail |
| Director / reviewer | Fabio | Spot-checks, portfolio views, exception reports | Reviews by sampling; needs provenance fast |
| Developer | Mani Shankarr | The repo | Consumer of these findings |
| CS agent | Klarstein CS | Spare parts & service info lookup, R2R repair routing | `[Guessing]` may read published output rather than use OriginFlow directly — confirm, it changes whether CS-facing surfaces are in scope |
| Supplier | HK/CN suppliers | IM intake submissions | `[Guessing]` intake may be file-based, not in-app |

---

## Jobs

Frequency scale: daily / weekly / per-launch / per-season / rare.
Stakes: **regulatory** (escapes to a published manual, EPREL, label, or R2R obligation), **commercial**, **internal-time-only**.

| # | Job | Role | Frequency | Volume per run | Stakes | What they do today instead / outside the tool |
|---|---|---|---|---|---|---|
| J1 | Validate & correct a category's PIM attributes | Category PM | `[Guessing]` per-season | up to ~360 SKUs | regulatory + commercial | Excel exports, manual diff |
| J2 | Sync internal values to an EPREL export and flag changes | PM / compliance | `[Guessing]` per-season | per category | regulatory | Excel + highlighting |
| J3 | Author a full instruction manual (multi-chapter, EU-27) | Author | per-launch | 1 SKU, 25+ chapters | regulatory | Word + supplier drafts |
| J4 | Assemble & publish an IM for a market set | Assembler | per-launch | 1 doc × N locales | regulatory | ? |
| J5 | Intake a supplier IM draft and audit it | Author | per-launch | 1 doc | regulatory | Prompt-driven audit outside the app |
| J6 | Product Passport / passport review | `[Guessing]` | `[Guessing]` | ? | regulatory | ? |
| J7 | Maintain spare parts & service information per SKU | `[Guessing]` PM | ongoing | portfolio-wide | regulatory (R2R 2024/1799) | Supplier lists, Elesco handoff |
| J8 | Import a category's attributes + SKU values | PM | per category | 2 files | internal-time | Prepared offline, then imported |
| J9 | Prepare a launch record / track a launch through stages | PM | per-launch | portfolio | commercial | Excel, SharePoint, Jira |
| J10 | Check who is behind on what | Team lead | weekly | team | internal-time | Jira dashboard |
| J11 | Spot-check an output before it goes out | Director | weekly | sampled | regulatory | Reads the artefact directly |
| J12 | Answer "where did this value come from?" | any | ad hoc | 1 value | regulatory | Asks a person |

> J12 is the load-bearing one. In a tool whose output lands in a legal document, provenance-at-point-of-decision is a feature, not a nice-to-have. If tracing a value's origin requires asking a colleague, that is a ladder-B finding wherever it appears.

---

## Environment constraints (affect what "good" means)

- ~18 EU markets + UK + AU; multi-locale is the default case, not an edge case.
- Regional SKU numbering: 10XXXXX EU / 12XXXXX UK / 13XXXXX AU — the same physical product exists as several SKUs. Any screen that treats an SKU as a product is suspect.
- Operators live in Excel and Akeneo. Anything that can't accept a pasted column or produce a pasteable one loses to Excel, and they will do the work in Excel.
- Sourcing via HK/CN suppliers: inputs arrive incomplete, in mixed formats, and late.
- Stack: React front end; Supabase (Pro, company-contracted) for the spare parts / service info module; `[Guessing]` MS SQL migration path and Akeneo sync job are in progress rather than finished — confirm before assuming either is the source of truth.
- Obsidian and M365 sit downstream; exports that can't be pasted into either are half-finished.

## Audit history

Prior reports live in `docs/ux-audit/`. Read the most recent one for the same scope before starting, and open the new report with the delta.
