# OriginFlow audit — <scope> — <YYYY-MM-DD>

**Scope chosen:** <job ID + name> — <one line on why this scope>
**Traced:** <entry route> → <key files/components> → <write path> → <side effects>
**Delta vs last report on this scope:** <fixed / still open / new — or "no prior report">

---

## 1. Verdict in three lines

<What this job costs the operator today, in mechanics: N steps, N required fields, N re-entries, N late failures. The one thing to fix first. What is already working and should not be touched.>

---

## 2. Ladder A — defects visible in code

### A1. <Short imperative title>
- **Role / job / frequency:** <role> · <J#> · <frequency>
- **Evidence:** `src/…/File.tsx:120-148` — <what the code does>
- **Consequence:** <what the operator experiences; what escapes if it goes wrong>
- **Blast radius:** <SKUs / markets / published docs affected by one occurrence>
- **Smallest viable change (S/M/L):** <the change>

*(repeat; renumber)*

---

## 3. Ladder B — workflow gaps traced through code

### B1. <Short imperative title>
- **Role / job / frequency:** …
- **What the job needs:** <step from users-and-jobs.md>
- **What the code supports:** `path:lines` — <the gap>
- **What they do today instead:** <Excel / Akeneo / ask a colleague>
- **Heuristic:** <H#>
- **Cost / risk:** <time per run × frequency; regulatory exposure if any>
- **Smallest viable change (S/M/L):** <the change> — *if L, also:* **S mitigation:** <70% of the value>

*(repeat)*

---

## 4. Ladder C — heuristic violations, cost unobserved

### C1. <Title> — <H#>
- **Evidence:** `path:lines`
- **Why it probably costs something:** <reasoning>
- **What would confirm it:** <the one observation or question>
- **Smallest viable change (S/M/L):** <the change>

*(repeat)*

---

## 5. Ladder D — speculative (max 3)

### D1. <Title>
- **Claim:** `[Guessing]` <the proposal>
- **Who it would serve and how often:** <role, frequency — flag if inferred>
- **What would promote or kill it:** <the measurement, or the question to ask a named person>
- **If admitted despite the banned list:** <justification>

---

## 6. Ranked shortlist

| # | Finding | Ladder | Role | Freq | Risk | Fix | Why this order |
|---|---|---|---|---|---|---|---|
| 1 | | | | | | S | |

---

## 7. Coverage

**Examined:** <files, routes, components>
**Not examined:** <modules, flows, states deliberately skipped — be specific>
**Blocked / could not verify:** <needs a running instance, real data volumes, DB access, or a person>
**Corrections needed in `users-and-jobs.md`:** <fields you had to guess>
