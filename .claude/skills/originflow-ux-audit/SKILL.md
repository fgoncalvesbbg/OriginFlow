---
name: originflow-ux-audit
argument-hint: [module or job, e.g. "IM assembly" or "J2 EPREL sync"]
allowed-tools: Read Grep Glob
description: Audit the OriginFlow codebase from the operator's point of view and propose grounded feature/UX changes. Use this skill whenever the user asks to review, critique, improve, or extend OriginFlow (or one of its modules — IM builder, EPREL/compliance QA, PIM validation, Product Passport Review, spare parts & service info, Category Tree, launch management) in terms of usability, workflow friction, missing features, or "what should we build next". Trigger it even when the request is phrased as "look at this module and tell me what's wrong", "what would a PM hate about this screen", "propose the next features", or "does this flow make sense" — any request for product judgement on OriginFlow, not just the word "UX". Do NOT use for pure bug-fixing, refactors, or when the user has already decided what to build and wants it implemented.
---

# OriginFlow UX & Feature Audit

## What this skill is for

Producing **evidence-grounded** findings about OriginFlow's workflows and interface, ranked by how much operator time and compliance risk they cost, each with a fix small enough to actually ship.

## What this skill is NOT for, and why that matters

You cannot simulate a user. You have no task pressure, no error rate, no deadline, no muscle memory, and no idea what the person had open in the other monitor. What you *can* do is:

- trace a named job end to end through the code and count the mechanics (steps, fields, round trips, re-entries, places where an error surfaces later than it was created);
- compare that trace against the job's real frequency and stakes from `references/users-and-jobs.md`;
- apply heuristics that hold for expert, high-volume, compliance-bearing internal tooling.

Everything beyond that is speculation and must be labelled and rationed. An unlabelled invented user need is the main failure mode of this skill — worse than missing a finding, because it costs the reader's trust in the whole report.

## Hard rules

1. **Cite or flag.** Every claim about how OriginFlow behaves cites `path/to/file.tsx:120-148` or a route/component/table name. Every claim you inferred without reading the code gets `[Guessing]` immediately before it. No `[Guessing]` on things you verified — over-flagging is as bad as under-flagging.
2. **No finding without a job.** Each finding names: the role affected, the job from `users-and-jobs.md`, how often they do it, and **what they do today instead** (spreadsheet, second screen, Teams message, re-check in Akeneo). If you can't fill those, the finding is speculation — move it to §5 or drop it.
3. **Evidence ladder.** Label every finding A–D (see below). Sort the report by ladder rank first, score second. Never present a D as if it were an A.
4. **Rationing.** Max 12 findings per run. Max 3 in §5 (speculative). If you have more, you haven't ranked hard enough.
5. **Smallest viable change.** Every finding ends with a change sized S (< half a day), M (1–3 days) or L (bigger, needs a spec). If the only fix you can think of is L, also state the S mitigation that buys 70% of the value.
6. **Read the banned list** in `references/heuristics.md` before writing §5. Those proposals are rejected on sight unless tied to a cited job step.
7. **Declare coverage.** End every report with what you did *not* open. A silent gap reads as a clean bill of health.
8. **Don't write code** unless asked. This skill produces findings, not diffs.

### Evidence ladder

| Rank | Meaning |
|---|---|
| **A** | Defect visible in code. Data loss, unhandled error path, missing validation, missing empty/loading state, N+1 on a list the user hits daily, destructive action with no confirm/undo. Cite the lines. |
| **B** | Workflow gap traced through code. The job requires a step the UI can't do (no bulk path, no paste-from-Excel, no way to see provenance, forced re-entry of data the system already holds). Cite the trace. |
| **C** | Heuristic violation. Matches a named heuristic in `references/heuristics.md`, grounded in code, but the cost depends on behaviour you can't observe. |
| **D** | Speculative. Plausible, unverified. Lives only in §5, capped at 3, each with the one measurement or question that would promote or kill it. |

## Procedure

### 0 — Scope

Requested scope: $ARGUMENTS

Default scope is **one job-to-be-done**, not the whole app. Whole-app sweeps produce shallow findings; a single traced job produces findings someone can act on.

Read `references/users-and-jobs.md`. If the user named a module or job, use it. If they said "improve OriginFlow" with no scope, pick the job with the highest `frequency × stakes` that hasn't been audited recently (check `docs/ux-audit/` for prior runs) and **state the choice in one line at the top of the report** — don't stop to ask unless two candidates are genuinely tied.

If the named job isn't in `users-and-jobs.md`, add it there with `[Guessing]` on every field you inferred, and tell the user at the end of the report that the entry needs correcting.

### 1 — Trace

Walk the job in the code, in the order the operator hits it:

entry point / route → auth & role gate → data fetch → form or table → validation → write path → side effects (sync, export, audit log) → success and failure states → where the operator goes next.

While tracing, record mechanically:

- **Steps**: clicks, page loads, modals, navigations from job start to done.
- **Fields**: required vs optional; how many the operator must type that the system already knows or could infer.
- **Re-entries**: any value the operator supplies twice, or copies between OriginFlow and Akeneo/Excel/EPREL.
- **Held state**: anything the operator must remember across a screen boundary (an SKU, a value to compare against, which of 364 rows they were on).
- **Late failure**: errors created at step N that only surface at step N+k. The gap is the cost.
- **Blast radius**: how many SKUs / markets / published documents one wrong action touches.
- **Latency**: list and query shapes over realistic row counts (hundreds to low thousands of SKUs, multi-locale).

Do not skip error, empty, partial and concurrent states. In this class of tool that's where most of the real pain lives, and it's the part that never gets designed.

### 2 — Classify and score

Score each finding:

- **Cost** = frequency of the job × operators affected × time or rework per occurrence.
- **Risk** = what escapes if it goes wrong: wrong value published to a manual, wrong EPREL/energy data, wrong spare-parts availability, missed R2R obligation, wrong market/locale. Compliance-visible risk outranks annoyance even at low frequency.
- **Fix size** = S / M / L.

Rank by `(Cost + Risk) / Fix size`, but present ladder A findings before B before C regardless of score.

### 3 — Write the report

Use `references/report-template.md` exactly. Save it to `docs/ux-audit/YYYY-MM-DD-<scope>.md` in the repo so runs accumulate and you can diff against the last one. If a prior report covered the same scope, open with a two-line delta: what got fixed, what's still open, what's new.

### 4 — Offer, don't sprawl

End with one question at most, and only if a real decision is blocked. Do not append a roadmap, a phased plan, or a set of next steps the user didn't ask for.

## Reference files

- `references/users-and-jobs.md` — roles, jobs, frequency, stakes. **This is the file that decides whether the output is useful or slop.** It ships seeded and partly guessed; correct it before trusting scores.
- `references/heuristics.md` — heuristics for expert compliance/data tooling, plus the banned-proposal list.
- `references/report-template.md` — required output shape.
