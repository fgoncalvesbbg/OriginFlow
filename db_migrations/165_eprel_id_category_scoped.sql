-- 165: Scope "EPREL ID" to the categories that actually carry an EU energy label.
--
-- Migration 161 added it as a GLOBAL attribute, which put it on every one of the 134 active
-- categories — and because it is supplier-visible, every supplier attribute request started
-- asking for an EPREL registration number, including for pergolas, kitchen knives and dartboards.
-- Asking a supplier for a registration number that cannot exist is the same class of waste as
-- re-asking for a field somebody already cleared (migration 164).
--
-- WHY NAMES AND NOT A RULE. There is no data in OriginFlow that says which categories are
-- energy-labelled — only four carry EPREL-mapped attributes today, and two of those are hoods.
-- So the set below is a reading of the EU labelling regulations against the category names, and
-- it is written out in full so it can be argued with. It is a SEED, not a definition: the Admin
-- panel's attribute→category assignment adjusts it without another migration.
--
-- SCOPE MECHANICS. `category_id` holds one owning category and `assigned_category_ids` the rest;
-- getAttributesForCategory matches either. The `group` stays '2. Standard Electric Specs' — the
-- live group names carry numeric prefixes that PREDEFINED_ATTRIBUTE_GROUPS does not, so
-- saveCategoryAttribute's group-based scope inference does not fire and category_id remains the
-- source of truth (see its comment about "category-scoped even though the group is predefined").
--
-- INCLUDED, by labelled product group:
--   Range hoods, Reg 65/2014 ............ Angled, Built-In, Ceiling, Chimney, Downdraft,
--                                         Island, Telescopic, Under-Cabinet Hoods, and
--                                         Hobs with Integrated Hoods (the hood half)
--   Refrigeration, Reg 2019/2016 ........ Beverage Coolers, the three Wine Cooler variants,
--                                         Chest/Freestanding/Mini Freezers, Fridges with and
--                                         without Freezers, Mini Fridges, Meat-Aging Refrigerators
--   Dishwashers, Reg 2019/2017 .......... Built-In, Freestanding, Tabletop
--   Household ovens, Reg 65/2014 ........ Built-In Ovens
--   Tumble dryers, Reg 392/2012 ......... Clothes Dryers
--   Air conditioners, Reg 626/2011 ...... Mobile Air Conditioners
--   Water heaters, Reg 812/2013 ......... Water Heaters
--   Local space heaters, Reg 2015/1186 .. Bathroom/Designer/Electric Radiators, Convectors,
--                                         Electric Fireplaces, Infrared Heaters, Infrared Panels
--
-- DELIBERATELY EXCLUDED, with the reason, because these are the ones worth arguing about:
--   * Microwave ovens (built-in and freestanding) — microwaves carry no EU energy label.
--   * Mini Ovens, Air Fry Ovens, Pizza Ovens — outside the household-oven scope.
--   * Hobs of every other kind — cooking hobs are not energy-labelled. Note that
--     Glass-Ceramic Hobs currently owns one EPREL-mapped attribute, which looks like a
--     definition error worth checking rather than a reason to include it here.
--   * Portable Refrigerators, Humidors — 12 V and cabinet coolers sit outside 2019/2016.
--   * Gas Heaters, Ethanol Heaters — non-electric local heaters; gas is arguably inside
--     2015/1186 but not confidently enough to ask suppliers for a number on it.
--   * Vacuum cleaners — the vacuum energy label was annulled by the CJEU in 2018.
--   * Fans, air coolers, air purifiers, dehumidifiers — no EU energy label.

with labelled as (
  select id, row_number() over (order by name) as rn
  from public.categories_l3
  -- ACTIVE only. Without this the first run also matched an inactive duplicate
  -- "Chimney Hoods" and assigned the attribute to a category nothing displays.
  where active and name in (
    -- Range hoods
    'Angled Hoods', 'Built-In Hoods', 'Ceiling Hoods', 'Chimney Hoods', 'Downdraft Hoods',
    'Island Hoods', 'Telescopic Hoods', 'Under-Cabinet Hoods', 'Hobs with Integrated Hoods',
    -- Refrigerating appliances
    'Beverage Coolers', 'Built-In Wine Coolers', 'Chest Freezers', 'Freestanding Freezers',
    'Freestanding Wine Coolers', 'Fridges with Freezers', 'Fridges without Freezers',
    'Meat-Aging Refrigerators', 'Mini Freezers', 'Mini Fridges', 'Under-Counter Wine Coolers',
    -- Dishwashers
    'Built-In Dishwashers', 'Freestanding Dishwashers', 'Tabletop Dishwashers',
    -- Ovens, dryers, air conditioning, water heating
    'Built-In Ovens', 'Clothes Dryers', 'Mobile Air Conditioners', 'Water Heaters',
    -- Local space heaters
    'Bathroom Radiators', 'Convectors', 'Designer Radiators', 'Electric Fireplaces',
    'Electric Radiators', 'Infrared Heaters', 'Infrared Panels'
  )
)
update public.category_attributes a
set category_id = (select id from labelled where rn = 1),
    assigned_category_ids = coalesce(
      (select array_agg(id::text order by id) from labelled where rn > 1),
      '{}'
    )
where a.category_id is null
  and lower(a.name) = 'eprel id'
  -- Guard: if the set above matches nothing (renamed categories), leave the attribute global
  -- rather than orphaning it onto a null category where it would appear nowhere at all.
  and exists (select 1 from labelled);
