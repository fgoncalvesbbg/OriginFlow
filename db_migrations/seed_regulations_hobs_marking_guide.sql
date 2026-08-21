-- Seed: regulations from the EE marking guide (Hobs / Induction hobs, R1 2025-07).
--
-- GENERATED from docs/EE marking guide_Hobs Induction hobs_R1_202507.xlsx.
-- Regenerate rather than hand-edit: the generator is .gen_reg_seed.py in the repo root
-- history, and hand edits here are lost the next time the guide is revised.
--
-- NOT a schema migration -- data only, and safe to re-run. Deliberately named
-- seed_* rather than 121_* so it is not mistaken for one.
--
-- WHAT IT WRITES, AND WHAT IT LEAVES ALONE
--
--   checklist, notes, title, jurisdiction -- OVERWRITTEN from the workbook. The guide
--                 is the authoritative source, so re-running re-syncs all four and any
--                 value edited in the app in the meantime is replaced.
--   summary_md -- NOT WRITTEN, because this workbook contains none. It is a marking
--                 GUIDE, not regulation text. Setting it from here would mean writing
--                 NULL over the summaries already uploaded, and the AI check reads
--                 summary_md and nothing else -- every future check would refuse to run.
--   status     -- set on INSERT only. Not overwritten, so a regulation deliberately
--                 retired as superseded is not silently brought back to active.
--
-- Five of these reference codes already exist in the library, so this is written as an
-- upsert on the unique lower(btrim(reference_code)) index rather than plain inserts,
-- which uq_regulations_reference_code would refuse.
--
-- REQUIRES migrations 116, 118, 119 and 120 to be applied first. 119 is the hard
-- dependency (it adds regulations.checklist) and the preflight below checks for it.
--
-- The category association at the end is what makes the checklist appear on the induction
-- hob templates (an active regulation listing a category applies to that category's
-- templates -- migration 116). Delete that block if you would rather assign by hand.

BEGIN;

-- Preflight: this seed writes regulations.checklist, which migration 119 adds. Without
-- that column the first INSERT fails with a bare "column does not exist"; say why instead.
DO $chk$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'regulations' AND column_name = 'checklist'
  ) THEN
    RAISE EXCEPTION 'regulations.checklist is missing -- apply db_migrations/119_regulation_checklist.sql before this seed.';
  END IF;
END $chk$;

-- EN IEC 60335-1:2021 — 33 checklist item(s)
INSERT INTO public.regulations (title, reference_code, jurisdiction, notes, checklist, status)
VALUES (
  $sql$Household and similar electrical appliances — Safety — Part 1: General requirements$sql$,
  $sql$EN IEC 60335-1:2021$sql$,
  $sql$EU$sql$,
  $sql$Marking, labelling and instruction obligations for hobs / induction hobs, taken from the EE marking guide (Hobs / Induction hobs, R1, 2025-07). Clause references are to EN IEC 60335-1:2021.$sql$,
  $sql$7.1 · Rating label, Sales packaging, IM, Product — Rated voltage or rated voltage range in volts (such as 220-240V~ / AC 220-240V)
7.1 · Rating label, Sales packaging, IM, Product — Symbol for nature of supply, unless the rated frequency is marked;
7.1 · Rating label, Sales packaging, IM, Product — Rated power input in watts or rated current in amperes; (such as 2400W)
7.1 · Rating label, Sales packaging, IM, Product — Name, trade mark or identification mark of the manufacturer or responsible vendor;
7.1 · Rating label, Sales packaging, IM, Product — model or type reference (Such as Model # 1234567)
7.3 · Rating label, Sales packaging, IM, Product — Appliances having a range of rated values and which can be operated without adjustment throughout the range shall be marked with the lower and upper limits of the range separated by a hyphen
7.7 · Rating label, IM, Product — Appliances to be connected to more than two supply conductors and appliances for multiple supply shall have a connection diagram fixed to them, unless the correct mode of connection is obvious
7.8 · Rating label, IM, Product — Except for type Z attachment, terminals used for connection to the supply mains shall be indicated as follows – terminals intended exclusively for the neutral conductor shall be indicated by the letter N; – protective earthing terminals shall be indicated – functional earthing terminals shall be indicated These indications shall not be placed on screws, removable washers or other parts which can be removed when conductors are being connected.
7.9 · Rating label, IM, Product — Marking or placing of switches which may cause a hazard.
7.1 · Rating label, IM, Product — The different positions of switches on stationary appliances and the different positions of controls on all appliances shall be indicated by figures, letters or other visual means. This requirement also applies to switches which are part of a control. - If figures are used for indicating the different positions, the off position shall be indicated by the figure 0 and the position for a higher value, such as output, input, speed or cooling effect, shall be indicated by a higher figure. - The figure 0 shall not be used for any other indication unless it is positioned and associated with other numbers so that it does not give rise to confusion with the indication of the off position. The figure 0 may be used on a digital programming keyboard.
7.11 · Rating label, IM, Product — Indication for direction of adjustment of controls
7.12 · IM, Product — Instructions shall be provided in hard copy form with the appliance so that the appliance can be used safely.
7.12 · IM, Product — If it is necessary to take precautions during user maintenance, appropriate details shall be given
7.12 · IM, Product — The instructions shall state the substance of the following: WARNING: - This appliance is not intended for use by persons (including children) with reduced physical, sensory or mental capabilities, or lack of experience and knowledge, unless they have been given supervision or instruction concerning use of the appliance by a person responsible for their safety. - Children should be supervised to ensure that they do not play with the appliance.
7.12.1 · IM, Product — If it is necessary to take precautions during installation of the appliance, appropriate details shall be given.
7.12.2 · IM, Product — If a stationary appliance is not fitted with a supply cord and a plug, or with other means for disconnection from the supply mains having a contact separation in all poles that provide full disconnection under overvoltage category III conditions, the instructions shall state that means for disconnection must be incorporated in the fixed wiring in accordance with the wiring rules.
7.12.3 · IM, Product — If the insulation of the fixed wiring supplying an appliance for permanent connection to the supply mains can come into contact with parts having temperature rise exceeding 50 K during the test of Clause 11 , the instructions shall state that the fixed wiring insulation must be protected, for example, by insulating sleeving having an appropriate temperature rating.
7.12.4 · IM, Product — The instructions for built-in appliances shall include information with regard to the following: – dimensions of the space to be provided for the appliance; – dimensions and position of the means for supporting and fixing the appliance within this space; – minimum distances between the various parts of the appliance and the surrounding structure; – minimum dimensions of ventilating openings and their correct arrangement; – connection of the appliance to the supply mains and the interconnection of any separate components; – necessity to allow disconnection of the appliance from the supply after installation, unless the appliance incorporates a switch complying with 24.3. The disconnection may be achieved by having the plug accessible or by incorporating a switch in the fixed wiring in accordance with the wiring rules.
7.12.5 · IM, Product — For appliances with type Y attachment, the instructions shall contain the substance of the following: If the supply cord is damaged, it must be replaced by the manufacturer, its service agent or similarly qualified persons in order to avoid a hazard.
7.12.5 · IM, Product — If a cord set is required to be provided with the appliance according to Subclause 22.58, the instructions shall contain the substance of the following: If the cord set is damaged, it must be replaced by a special cord set available from the manufacturer or its service agent.
7.12.7 · IM, Product — The instructions for fixed appliances shall state how the appliance is to be fixed to its support. The method of fixing stated is not to depend on the use of adhesives since they are not considered to be a reliable fixing means.
7.12.9 · IM, Product — For each language, the instructions specified in 7.12 and from 7.12.1 to 7.12.8 shall be in hard copy form and shall appear together before any other instructions supplied with the appliance. Alternatively, these instructions may be supplied with the appliance separately from any functional use booklet. They may follow the description of the appliance that identifies parts, or follow the drawings/sketches common to the languages of the instructions.
7.12.9 · IM, Product — In addition, instructions shall also be available in an alternative format such as on a website or on request from the user in a format such as a DVD.
7.13 · IM, Product — Instructions and other text required by this standard shall be written in an official language of the country in which the appliance is to be sold.
7.14 · IM, Product — The markings shall be clearly legible
7.14 · IM, Product — The signal words WARNING, CAUTION, DANGER if in the Latin alphabet shall be in uppercase having a height not less than: – 3,5 mm for appliances normally used on the floor; – 2,0 mm for portable appliances with a printable surface of less than 1 0 cm 2 ; and – 3,0 mm for other appliances.
7.14 · IM, Product — Uppercase letter of the text explaining the signal word shall be no smaller than 1 ,6 mm, with other letters according to the font size of the uppercase letter.
7.14 · IM, Product — Countries that do not use the Latin alphabet need to specify the minimum size of the script to be used taking into account what is specified for the Latin alphabet.
7.14 · IM, Product — Unless contrasting colours are used, moulded in, engraved, or stamped markings shall be either raised above or have a depth below the surface of at least 0,25 mm.
7.14 · IM, Product — The markings required by this standard shall be durable. On containers that are likely to be cleaned frequently, the markings shall not be by means of paint or enamel, other than vitreous enamel.
7.15 · Rating label, IM, Product — The markings specified in 7.1 to 7.5 shall be on a main part of the appliance.
7.15 · Rating label, IM, Product — Markings on the appliance shall be clearly discernible from the outside of the appliance but if necessary after removal of a cover. For portable appliances, it shall be possible to remove or open this cover without the aid of a tool.
7.15 · Rating label, IM, Product — Indications for switches and controls shall be placed on or near these components. They shall not be placed on parts which can be positioned or repositioned in such a way that the marking is misleading.$sql$,
  'active'
)
ON CONFLICT (lower(btrim(reference_code))) DO UPDATE SET
  checklist    = EXCLUDED.checklist,
  notes        = EXCLUDED.notes,
  title        = EXCLUDED.title,
  jurisdiction = EXCLUDED.jurisdiction,
  updated_at   = NOW();

-- EN IEC 60335-2-6:2024 — 5 checklist item(s)
INSERT INTO public.regulations (title, reference_code, jurisdiction, notes, checklist, status)
VALUES (
  $sql$Household and similar electrical appliances — Safety — Part 2-6: Particular requirements for stationary cooking ranges, hobs, ovens and similar appliances$sql$,
  $sql$EN IEC 60335-2-6:2024$sql$,
  $sql$EU$sql$,
  $sql$Marking, labelling and instruction obligations for hobs / induction hobs, taken from the EE marking guide (Hobs / Induction hobs, R1, 2025-07). Clause references are to EN IEC 60335-2-6:2024.$sql$,
  $sql$7.9 · Rating label, IM, Product — Flexible induction cooking zone switches, touch controls, displays and the like shall be marked or placed so as to indicate clearly as to which vessel is assigned to which switch, touch control, display or the like.
7.12 · IM, Product — The instructions for cooking ranges, hobs and ovens shall state that a steam cleaner is not to be used
7.12 · IM, Product — The instructions for hobs shall state that the appliance is not intended to be operated by means of an external timer or separate remote-control system. However, for hobs with a remote automatic regulation system, the instructions shall include the following: – information to identify the remote automatic regulation system; – description of the way of connection of the remote automatic regulation system; – precautions and recommendations for the safe operation of the remote automatic regulation system; – an illustration depicting the location of the remote automatic regulation system; and – description of how to enable and disable the remote communication of the hob with the remote automatic regulation system.
7.12 · IM, Product — The instructions for hobs shall include the substance of the following: Danger of fire: Do not store items on the cooking surfaces. CAUTION: The cooking process has to be supervised. A short term cooking process has to be supervised continuously. WARNING: Unattended cooking on a hob with fat or oil can be dangerous and can result in a fire.
7.15 · Rating label, IM, Product — For fixed appliances, the marking of the name or trademark or identification mark of the manufacturer or responsible vendor and the model or type reference shall be marked on the appliance and, if not visible when the appliance is installed as in normal use, shall be included in the instructions or on an additional label that can be fixed near the appliance after installation.$sql$,
  'active'
)
ON CONFLICT (lower(btrim(reference_code))) DO UPDATE SET
  checklist    = EXCLUDED.checklist,
  notes        = EXCLUDED.notes,
  title        = EXCLUDED.title,
  jurisdiction = EXCLUDED.jurisdiction,
  updated_at   = NOW();

-- Blue Guide 2022 — 1 checklist item(s)
INSERT INTO public.regulations (title, reference_code, jurisdiction, notes, checklist, status)
VALUES (
  $sql$The 'Blue Guide' on the implementation of EU product rules 2022$sql$,
  $sql$Blue Guide 2022$sql$,
  $sql$EU$sql$,
  $sql$Marking, labelling and instruction obligations for hobs / induction hobs, taken from the EE marking guide (Hobs / Induction hobs, R1, 2025-07). Clause references are to Blue Guide 2022.$sql$,
  $sql$4.5.1 · Rating label, Product (optional: Sales packaging, IM) — CE mark (MIN high 5mm)$sql$,
  'active'
)
ON CONFLICT (lower(btrim(reference_code))) DO UPDATE SET
  checklist    = EXCLUDED.checklist,
  notes        = EXCLUDED.notes,
  title        = EXCLUDED.title,
  jurisdiction = EXCLUDED.jurisdiction,
  updated_at   = NOW();

-- Directive 2012/19/EU WEEE — 1 checklist item(s)
INSERT INTO public.regulations (title, reference_code, jurisdiction, notes, checklist, status)
VALUES (
  $sql$Directive 2012/19/EU on waste electrical and electronic equipment (WEEE)$sql$,
  $sql$Directive 2012/19/EU WEEE$sql$,
  $sql$EU$sql$,
  $sql$Marking, labelling and instruction obligations for hobs / induction hobs, taken from the EE marking guide (Hobs / Induction hobs, R1, 2025-07). Clause references are to Directive 2012/19/EU WEEE.$sql$,
  $sql$ANNEX IX · Rating label, Product (optional: Sales packaging, IM) — WEEE mark (MIN height 7mm)$sql$,
  'active'
)
ON CONFLICT (lower(btrim(reference_code))) DO UPDATE SET
  checklist    = EXCLUDED.checklist,
  notes        = EXCLUDED.notes,
  title        = EXCLUDED.title,
  jurisdiction = EXCLUDED.jurisdiction,
  updated_at   = NOW();

-- UKCA marking guidance — 1 checklist item(s)
INSERT INTO public.regulations (title, reference_code, jurisdiction, notes, checklist, status)
VALUES (
  $sql$Guidance on using the UKCA marking$sql$,
  $sql$UKCA marking guidance$sql$,
  $sql$UK$sql$,
  $sql$Marking, labelling and instruction obligations for hobs / induction hobs, taken from the EE marking guide (Hobs / Induction hobs, R1, 2025-07). Clause references are to UKCA marking guidance.$sql$,
  $sql$Guidance using the UKCA marking · Rating label, Product (optional: Sales packaging, IM) — UKCA mark for UK only (MIN high 5mm)$sql$,
  'active'
)
ON CONFLICT (lower(btrim(reference_code))) DO UPDATE SET
  checklist    = EXCLUDED.checklist,
  notes        = EXCLUDED.notes,
  title        = EXCLUDED.title,
  jurisdiction = EXCLUDED.jurisdiction,
  updated_at   = NOW();

-- Regulation (EU) 2023/826 — 2 checklist item(s)
INSERT INTO public.regulations (title, reference_code, jurisdiction, notes, checklist, status)
VALUES (
  $sql$Commission Regulation (EU) 2023/826 — ecodesign requirements for off mode, standby mode and networked standby energy consumption$sql$,
  $sql$Regulation (EU) 2023/826$sql$,
  $sql$EU$sql$,
  $sql$Marking, labelling and instruction obligations for hobs / induction hobs, taken from the EE marking guide (Hobs / Induction hobs, R1, 2025-07). Clause references are to Regulation (EU) 2023/826.$sql$,
  $sql$ANNEX II & III · IM, Product — Standby mode or Off mode < 0.5W (9-May-2025); Off mode < 0.3W (9-May-2027); (power consumption expressed in watts rounded to the first decimal place);
ANNEX II & III · IM, Product — The period after which the power management function switches the equipment into standby mode (in minutes.$sql$,
  'active'
)
ON CONFLICT (lower(btrim(reference_code))) DO UPDATE SET
  checklist    = EXCLUDED.checklist,
  notes        = EXCLUDED.notes,
  title        = EXCLUDED.title,
  jurisdiction = EXCLUDED.jurisdiction,
  updated_at   = NOW();

-- Regulation (EU) No 66/2014 — 1 checklist item(s)
INSERT INTO public.regulations (title, reference_code, jurisdiction, notes, checklist, status)
VALUES (
  $sql$Commission Regulation (EU) No 66/2014 — ecodesign requirements for domestic ovens, hobs and range hoods$sql$,
  $sql$Regulation (EU) No 66/2014$sql$,
  $sql$EU$sql$,
  $sql$Marking, labelling and instruction obligations for hobs / induction hobs, taken from the EE marking guide (Hobs / Induction hobs, R1, 2025-07). Clause references are to Regulation (EU) No 66/2014.$sql$,
  $sql$ANNEX I · IM, Product (optional: Sales packaging) — Information for domestic electric hobs. > Note: Table 5a & 5c$sql$,
  'active'
)
ON CONFLICT (lower(btrim(reference_code))) DO UPDATE SET
  checklist    = EXCLUDED.checklist,
  notes        = EXCLUDED.notes,
  title        = EXCLUDED.title,
  jurisdiction = EXCLUDED.jurisdiction,
  updated_at   = NOW();

-- Associate all seven with the induction hob category, which is what surfaces the
-- checklist on its templates (an active regulation listing a category applies to that
-- category's templates -- migration 116). The name match is deliberately loose because
-- the category may be named "Induction hob", "Induction hobs" or "Hobs / Induction hobs".
--
-- Written as a set union rather than `UPDATE ... FROM categories_l3` + array_append: that
-- join form appends only ONE category id when several names match, because the target row
-- is updated once against an arbitrarily chosen joined row. The union below adds every
-- match, keeps categories already present (so other categories are never stripped), and
-- is idempotent on a re-run.
UPDATE public.regulations r
   SET applicable_categories = COALESCE((
         SELECT array_agg(DISTINCT x)
           FROM (
                 SELECT unnest(r.applicable_categories) AS x
                  UNION
                 SELECT c.id::text FROM public.categories_l3 c WHERE c.name ILIKE '%induction%'
                ) s
       ), '{}'),
       updated_at = NOW()
 WHERE lower(btrim(r.reference_code)) IN (
         lower(btrim($sql$EN IEC 60335-1:2021$sql$)),
         lower(btrim($sql$EN IEC 60335-2-6:2024$sql$)),
         lower(btrim($sql$Blue Guide 2022$sql$)),
         lower(btrim($sql$Directive 2012/19/EU WEEE$sql$)),
         lower(btrim($sql$UKCA marking guidance$sql$)),
         lower(btrim($sql$Regulation (EU) 2023/826$sql$)),
         lower(btrim($sql$Regulation (EU) No 66/2014$sql$))
 );

-- Sanity check: what the script just wrote. Nothing is committed if this looks wrong --
-- ROLLBACK instead of COMMIT.
SELECT reference_code,
       jurisdiction,
       array_length(string_to_array(checklist, E'\n'), 1) AS checklist_items,
       (summary_md IS NOT NULL) AS has_summary,
       applicable_categories
  FROM public.regulations
 WHERE lower(btrim(reference_code)) IN (
         lower(btrim($sql$EN IEC 60335-1:2021$sql$)),
         lower(btrim($sql$EN IEC 60335-2-6:2024$sql$)),
         lower(btrim($sql$Blue Guide 2022$sql$)),
         lower(btrim($sql$Directive 2012/19/EU WEEE$sql$)),
         lower(btrim($sql$UKCA marking guidance$sql$)),
         lower(btrim($sql$Regulation (EU) 2023/826$sql$)),
         lower(btrim($sql$Regulation (EU) No 66/2014$sql$))
 )
 ORDER BY reference_code;

COMMIT;

NOTIFY pgrst, 'reload schema';
