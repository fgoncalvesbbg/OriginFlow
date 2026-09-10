# One TCF requirement, many regulations

**Status:** proposal, nothing implemented. Written 2026-09-10 alongside the library dedupe
(`db_migrations/177_regulation_library_dedupe.sql`).

## The problem, in the live data

`compliance_requirements.regulation_id` is a single nullable uuid. A requirement that covers
several instruments has to pick one and name the rest in free text. Counted against production
on 2026-09-10 — of 29 requirements:

| Instruments named in the title | Requirements |
|---|---|
| 3 | 3 |
| 2 | 4 |
| 1 | 7 |
| 0 | 15 |

Seven requirements name two or three instruments and can link only one. For example:

> *"Ecodesign Regulation (EU) 2024/1781, ErP Directive 2009/125/EC, (EU) No 66/2014 test
> report"* → `regulation_id` points at **66/2014** only.

> *"Food contact test report as per Regulation 1935/2004/EC (and LFGB BfR §30 / §31 for
> Germany)"* → `regulation_id` points at **1935/2004** only.

### What that costs

1. **The library lies about coverage.** ErP `2009/125/EC`, `2017/1369`, ESPR `2024/1781` and
   `LFGB (BfR §30, §31)` each have **zero** linked requirements while being named in 3–4
   requirement titles. On the Regulations page they read as unused, and they were the leading
   candidates when someone asked to "delete any regulation not being used" — the schema's
   inability to record the link is what makes real obligations look like dead rows.
2. **`regulation-usage.service.ts` under-reports.** Its whole job is "who answers for this
   regulation?", joining requirements on `regulation_id`. Open ErP `2009/125/EC` and the TCF
   half is empty, even though four requirements demand ErP evidence.
3. **The expiry gate has a hole.** `ComplianceRequestDetail` resolves blocks from
   `requirement.regulationId` (one row). If ESPR expired, the three requirements that cite it
   in text but link 66/2014 or 2019/1782 would not block — the exact fail-open shape migration
   140 was written to close.
4. **The same instruments look "repeated" on screen**, because they keep reappearing as
   free text inside requirement titles rather than as one linked row.

## Shape: reuse migration 173, don't invent

Migration 173 solved the identical problem one axis over — one requirement, many *categories* —
with `assigned_category_ids uuid[]` rather than a junction table, deliberately borrowing the
shape `category_attributes` already used. The same move applies here:

```sql
alter table compliance_requirements
  add column regulation_ids uuid[] not null default '{}';
```

`regulation_id` stays as the **primary** citation — it is what `clause_id` hangs off, what the
requirement card headlines, and what 30-odd call sites read. `regulation_ids` carries the
additional instruments. Resolution is "primary, plus every id in the array", which keeps every
existing read correct while making the extra links visible.

Why an array over a junction table, same reasoning as 173: one column instead of a table plus
its RLS, its grants and its joins; and the stale-id behaviour is already established.

### Why not widen `clause_id`

A clause belongs to exactly one regulation, so a per-regulation clause pin would need
`{regulation_id, clause_id}` pairs — a junction table after all. Almost none of the real data
wants it: the seven multi-instrument requirements cite whole instruments ("test report per X, Y
and Z"), not clauses. Keep `clause_id` pinned to the primary regulation and treat the extras as
instrument-level citations. If clause-level multi-citation is ever needed, that is the moment
for the junction table, not before.

## Work implied

- **Migration**: add the column; backfill the seven requirements from the instruments named in
  their titles (a human should confirm each — the titles are inconsistent, e.g.
  `"RED Directive 2015/53"` was simply wrong until 177 fixed it).
- **`compliance-requirement.service.ts`**: map the column, and keep refusing a requirement with
  no regulation at all (see the note at line 211).
- **`regulation-usage.service.ts`**: match on `regulation_id OR regulation_ids @> [id]`, so the
  TCF half is complete. This is the change that makes the framework rows stop looking dead.
- **Expiry**: `collectBlocks` must consider every cited regulation, not just the primary.
  Fail-closed, consistent with migration 140.
- **UI**: the requirement editor needs a multi-select; the card should list the extra citations.
  A requirement's regulation chip is currently singular in `ComplianceRequestDetail` (~line 573).
- **RLS**: none. The column rides on the existing `compliance_requirements` policies.

## Deliberately out of scope

Merging regulation rows. The EN 60335-1 pair looked like the case for it and was not — two
editions, two extraction registers, zero exact-duplicate obligations. See the header of
migration 177. Supersession, not merging, is how this library records "we only want one of
these"; nothing here changes that.
