# Heuristics for expert, high-volume, compliance-bearing internal tooling

These are not Nielsen's ten. Generic usability heuristics mostly optimise for first-time discoverability, which is the wrong target: OriginFlow's users are a handful of experts who will use the same screen hundreds of times and whose mistakes end up in legally binding documents. Cite the heuristic by ID in findings.

## H1 — Throughput beats discoverability
After the third use, guidance becomes obstruction. Wizards, multi-step modals, confirmation interstitials and "helpful" intro text cost time on every subsequent run. Look for: linear wizards on jobs done weekly; required navigation between fields that are always filled together; anything that can't be completed from the keyboard.

## H2 — Bulk is the unit of work, not the record
If a job touches 300+ SKUs (J1, J2, J7), a per-record UI is the defect — even a beautiful one. Look for: no multi-select, no bulk edit, no "apply to filtered set", no CSV/paste in, no export out, pagination that loses selection, filters that reset on navigation.

## H3 — Provenance at the point of decision
Every value that could be wrong must show, in place: where it came from (supplier / EPREL / Akeneo / manual entry / inferred), when, by whom, and whether it has been verified. Requiring a second screen — or a colleague — to answer that is a ladder-B finding. This is the single highest-value pattern in this codebase.

## H4 — Fail at entry, not at publish
Validation that only runs at publish time converts a 5-second correction into a rework cycle across chapters and locales. Look for: validation on the write path only; publish-time errors with no deep link back to the offending field; no way to see all outstanding problems for a document or category in one list.

## H5 — Blast radius must be visible before commit
Any action touching multiple SKUs, markets, or published artefacts needs a preview of what will change, a count, and an undo or a snapshot. Look for: bulk writes with a single confirm; imports that overwrite silently; sync jobs with no dry-run; delete without soft-delete.

## H6 — Reference vs copy semantics must be legible
Where content blocks are shared or inherited (IM chapters, boilerplate, regulatory clauses), the operator must be able to tell at a glance whether an edit propagates or forks. Ambiguity here produces both kinds of error — unwanted propagation and stale copies. Look for: no visual distinction between linked and local content; no "used in N documents" indicator; no warning on editing shared content.

## H7 — Multi-locale is the default path
Single-locale UI in a 20-market business is a hidden defect. Look for: locale as an afterthought toggle; no view of translation coverage/staleness per document; no way to see which markets have a published version and at what revision; source-language edits with no downstream invalidation.

## H8 — SKU ≠ product
Regional variants (10/12/13 prefixes) share content but differ in compliance requirements. Look for: screens that force per-SKU duplication of identical content, or conversely share content across regions where the requirement differs.

## H9 — Long-form work must survive the session
Multi-chapter authoring means long edit sessions. Look for: no autosave, no draft recovery, no conflict detection on concurrent edit, no revision history, navigation that discards unsaved state.

## H10 — Every async job needs a status the operator can act on
Imports, syncs, exports, PDF generation, nightly jobs. Look for: fire-and-forget with no progress, no partial-failure reporting (which rows failed and why), no retry of just the failures, no history of past runs.

## H11 — Handoff needs an explicit state
The author/assembler boundary is only real if the system models "ready for assembly", "returned with comments", "published". Implicit handoff via chat is a ladder-B finding. Look for: no queue per role; no reason-for-return; no notification of state change.

## H12 — The exit door matters as much as the entry
Operators will need the data elsewhere (Excel, Obsidian, Word, a supplier email). If getting it out means screenshots or retyping, the tool is a data prison and they will keep a shadow copy — which then becomes the real source of truth. Look for: views with no export; exports that lose structure; no stable deep link to a record.

## H13 — Empty, partial and error states are the product
For internal tools these are hit constantly (incomplete supplier data, half-finished categories). An empty state that doesn't say what to do next, or an error that doesn't say which field and why, is a real defect and belongs on ladder A when the code shows it's unhandled.

## H14 — Reviewers sample; make sampling cheap
Directors and process owners don't read everything, they check a few. Look for: no way to filter to "changed since last review", "flagged", "guessed/unverified", "published without review".

---

# Banned proposals

Rejected on sight unless the finding cites a specific job step from `users-and-jobs.md` **and** names the operator time or compliance risk it removes. These are what a language model proposes when it has run out of evidence, and their presence in a report is a signal that the audit went shallow.

- Dark mode / theming / "modernise the visual design" / rounded corners
- An AI chat assistant, "ask your data", or a copilot sidebar
- A generic dashboard with KPI cards, unless the report names the decision each card changes and who makes it
- Onboarding tour, tooltips-everywhere, empty-state illustrations
- Gamification, streaks, badges, progress rings
- Notification centre / activity feed with no named job that currently fails for lack of it
- Mobile app or "responsive-first", unless a job is genuinely done away from a desk
- Drag-and-drop kanban as a replacement for a working list view
- Keyboard shortcuts as a generic feature — allowed only when tied to a specific repeated action and its current click count
- Global search, unless the trace shows an operator currently navigating by memory to find records
- Real-time collaboration / presence cursors, unless two named roles edit the same object simultaneously
- Micro-interactions, animations, skeleton-loader polish
- "Integrate with X" where X is not already in the stack

If a banned item *does* earn its place through evidence, say so explicitly: "normally banned, admitted because …". That keeps the reader's trust calibrated.
