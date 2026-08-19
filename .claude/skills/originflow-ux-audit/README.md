# originflow-ux-audit

A skill that reviews OriginFlow's workflows and interface from the operator's point of view and returns ranked, evidence-grounded findings with fixes sized to ship.

## Install (Claude Code, in the OriginFlow repo)

Copy the whole folder into the repo, keeping the directory name — **the directory name is the command you type**:

```
<repo>/.claude/skills/originflow-ux-audit/
    SKILL.md
    references/users-and-jobs.md
    references/heuristics.md
    references/report-template.md
```

```bash
cd <originflow-repo>
mkdir -p .claude/skills
cp -r ~/Downloads/originflow-ux-audit .claude/skills/
```

If `.claude/skills/` did not exist before you started the session, **restart Claude Code** so it watches the new directory. Later edits to `SKILL.md` are picked up live, no restart needed.

Then:

```
/originflow-ux-audit IM assembly
/originflow-ux-audit J2 EPREL sync
/originflow-ux-audit                  # picks the highest-value unaudited job itself
```

Want the shorter `/ux-audit`? Rename the directory to `ux-audit`. The `name:` field in the frontmatter is only a display label for project skills — it does not set the command.

Verify it loaded: `/skills`, or ask "what skills are available?".

Commit the folder. Project skills in `.claude/skills/` are shared with anyone else working in the repo, which is what you want for Mani.

### Optional frontmatter changes, and their tradeoffs

- **`context: fork` + `agent: general-purpose`** runs the audit in a subagent so the trace doesn't consume your main session context. Cost: you can't interrogate findings mid-run. Do *not* pair with `agent: Explore` — Explore is read-only and can't write the report file. Add `background: false` if you want the result in the same turn.
- **`disable-model-invocation: true`** stops Claude auto-loading the skill during unrelated OriginFlow work. Add it if the description over-fires; leave it off while you're still calibrating.
- **`allowed-tools: Read Grep Glob`** is already set, so the trace doesn't prompt for approval on every file read. The grant lasts one turn only.
- **Uploading to claude.ai or Cowork**: strip `argument-hint` first. Only `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools` are accepted there, and an extra field is a hard error, not a warning.

Reports land in `docs/ux-audit/YYYY-MM-DD-<scope>.md`, committed alongside the code, so successive runs diff against each other instead of repeating themselves.

## Before the first run — do this, or the output will be plausible and wrong

`references/users-and-jobs.md` ships seeded and partly guessed. Frequency and stakes in that file drive the entire ranking. Correct at minimum:

1. Every `[Guessing]` line.
2. The **frequency** column for J1–J12.
3. The **"what they do today instead"** column — this is the field that turns generic UX advice into a specific claim about lost hours, and it is the one thing that cannot be recovered from the codebase.
4. Whether CS agents and suppliers touch OriginFlow directly or only its published output. That single answer changes which surfaces are in scope.

Fifteen minutes on that file is worth more than any wording change to the skill itself.

## Design decisions worth knowing

- **Scope is one job, not the app.** Whole-app sweeps produce shallow, interchangeable findings. A single traced job produces findings with line numbers.
- **Evidence ladder A–D.** Code-visible defects outrank traced workflow gaps, which outrank heuristic violations, which outrank speculation. Speculation is capped at 3 per run and must carry the measurement that would kill it.
- **Banned-proposal list** in `heuristics.md`. Dark mode, copilot sidebars, generic dashboards, gamification and friends are rejected unless tied to a cited job step. This is the main defence against confident-sounding filler.
- **Heuristics are tuned for expert compliance tooling**, not first-run discoverability: bulk as the unit of work, provenance at the point of decision, fail-at-entry validation, visible blast radius, multi-locale by default, SKU ≠ product.

## Known limits

- It cannot observe real behaviour. Ladder C and D findings stay unresolved until someone watches an operator or instruments the app. If you want those resolved, add three events — job started, job completed, error surfaced — with timestamps, and re-run the audit against the data.
- It reads what the code does, not what the operators tolerate. A workflow can be technically clean and still be abandoned in favour of Excel.
- It will over-value provenance and bulk editing, because those are the strongest patterns in this domain. If two consecutive reports keep landing there, that is either a real gap or a bias — check which.
