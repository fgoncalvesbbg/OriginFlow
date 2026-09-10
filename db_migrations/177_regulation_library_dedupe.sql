-- 177: the duplicate EN 60335-1 library entry, and four smaller data faults.
--
-- APPLIED 2026-09-10 via MCP against ecueltibpmpnhnaxlskx, not by a runner. This file is the
-- record of WHY, because the reasoning is not recoverable from the rows themselves. Verify
-- with the queries at the bottom rather than trusting this comment.
--
-- THE DUPLICATE. The library carried EN 60335-1 twice:
--
--   e81b8dd4  EN 60335-1:2012+A11+A13+A1+A14+A2+A15:2021   25 clauses / 28 obligations
--   317a13f3  EN IEC 60335-1:2021                          17 clauses / 33 obligations
--
-- Same title (hyphen vs em-dash), same Chapter 7 subject, and both summaries happen to be
-- 18 461 characters — which is what made them look like one row imported twice. They are not.
-- The md5s differ, the formats differ (YAML frontmatter vs a markdown heading), and more
-- importantly THESE ARE TWO EDITIONS OF THE STANDARD: EN 60335-1:2012+A15:2021 is Ed. 5.2,
-- EN IEC 60335-1:2021 is the EN adoption of IEC 60335-1 Ed. 6. Distinct CENELEC documents.
--
-- SO THEY WERE NOT MERGED. A TCF cites the edition its test report was issued against, so
-- collapsing the two into one row would have destroyed a fact the technical file depends on.
-- Ed. 5.2 is instead marked `superseded` with `superseded_by_id` recording the successor —
-- which per regulation-lifecycle.ts hides it from the assignment picker, leaves every existing
-- use working, and blocks nothing. `expired` would have been wrong: it gates publishes.
--
-- The second reason not to merge: NONE of the 61 obligations across the two rows is an exact
-- duplicate of another. They are two extractions in different registers — Ed. 5.2 has one
-- paraphrased one-liner per clause ("The appliance must be marked with its rated voltage..."),
-- the IEC row has the granular near-verbatim split (six items under 7.1 alone). Checklist
-- items are content-keyed (regulation-checklist.ts), so those texts would NOT have collapsed:
-- a union would have asked the reviewer the same question twice under clause 7.1 and 7.14.
--
-- WHAT DID MOVE ONTO THE SURVIVOR, being edition-agnostic:
--   - clause TITLES ("Marking", "Instructions", ...). The IEC row's were all NULL.
--   - applicable_categories, as a UNION. Category assignment is load-bearing since migration
--     116: a listed category makes the regulation apply to that category's IM templates.
--   - tcf_description (a generic "supply an LVD test report" sentence).
-- Deliberately NOT copied: version, edition_year, issued_at, last_amended_at, source_url.
-- Those describe Ed. 5.2 and would have mislabelled the 2021 IEC edition as "Ed. 5.2" issued
-- 2012-01-20.
--
-- THE FOUR SMALLER FAULTS:
--   - IEC 60335-2-30 carried celex_id 32023D2723. A standard has no CELEX at all, and that
--     number is an unrelated Commission Decision, so the version checker was pointed at the
--     wrong document. Cleared. Its title also read "IEC 60335-2-30 - Heaters IM Requirements",
--     describing our use of it rather than the standard; restored to the real name.
--   - "RED Directive 2015/53" — no such instrument. RED is 2014/53/EU.
--   - " EN 60529" (leading space) and "ErP Directive 2009/125/EC," (trailing comma).
--   - The REACH SVHC test-report requirement had regulation_id NULL although the REACH row
--     existed and a different requirement (Battery MSDS) was already linked to it. Linked,
--     and "non-presense" corrected.
--
-- STILL OPEN, deliberately. Eight regulations have no requirement, no clause, no obligation
-- and no category. None was deleted: four (ErP 2009/125/EC, 2017/1369, ESPR 2024/1781, LFGB)
-- are named inside other requirements' TITLES and are exactly the rows that a
-- many-regulations-per-requirement change would link — see
-- docs/originflow-multi-regulation-requirements.md; the other four (2025/138, 2022/30,
-- EN 18031-1, EN 18031-2) are the RED cybersecurity set, created hours before this cleanup and
-- most likely an in-progress workstream.

begin;

update regulation_clauses tgt
set title = src.title, updated_at = now()
from regulation_clauses src
where tgt.regulation_id = '317a13f3-6178-43c1-b534-e162ae744ef9'
  and src.regulation_id = 'e81b8dd4-7c27-49d7-abe3-84c6549a0309'
  and src.number = tgt.number
  and tgt.title is null and src.title is not null;

update regulations r
set applicable_categories = sub.merged,
    tcf_description = coalesce(nullif(r.tcf_description,''),
      'The supplier must provide evidence of compliance with all applicable clauses of this standard, typically via an LVD test report from an accredited laboratory. The marking and instruction requirements must be implemented on the product and in the user manual.'),
    updated_at = now()
from (
  select array(select distinct e from (
    select unnest(applicable_categories) e from regulations
    where id in ('317a13f3-6178-43c1-b534-e162ae744ef9','e81b8dd4-7c27-49d7-abe3-84c6549a0309')
  ) t order by e) as merged
) sub
where r.id = '317a13f3-6178-43c1-b534-e162ae744ef9';

update regulations
set status = 'superseded',
    superseded_by_id = '317a13f3-6178-43c1-b534-e162ae744ef9',
    updated_at = now()
where id = 'e81b8dd4-7c27-49d7-abe3-84c6549a0309';

update compliance_requirements set reference_code = 'RED Directive 2014/53/EU'
where id = 'f7be2225-e4c5-43af-bd41-9eb89de3b4d3';
update compliance_requirements set reference_code = 'EN 60529'
where id = '49dfeb83-ba07-4b8f-a496-f894d85319f4';
update compliance_requirements set reference_code = 'ErP Directive 2009/125/EC'
where id = '3861b693-744f-4754-8d29-9b34242fd5da';

update regulations
set celex_id = null,
    title = 'Household and similar electrical appliances — Safety — Part 2-30: Particular requirements for room heaters',
    updated_at = now()
where id = '9165d18f-3510-416a-8d6f-9826b4b55bf8';

update compliance_requirements
set regulation_id = '192588fd-a029-415c-bdce-132927fb6135',
    title = 'REACH - Test Report of non-presence of SVHC'
where id = 'ad760b2f-b068-42b2-ba0e-04fc6ecd76fd';

commit;

-- VERIFY (do not trust the header):
--   select reference_code, status, superseded_by_id is not null,
--          array_length(applicable_categories,1),
--          (select count(*) from regulation_clauses c
--             where c.regulation_id=r.id and c.title is not null)
--     from regulations r where reference_code like 'EN%60335-1%';
--   -- expect: EN IEC 60335-1:2021 active, 2 categories, 17/17 clauses titled;
--   --         EN 60335-1:2012+... superseded with a successor, 25 clauses retained.
