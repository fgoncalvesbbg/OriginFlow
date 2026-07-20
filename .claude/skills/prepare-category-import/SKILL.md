---
name: prepare-category-import
description: Convert a raw category data export (one row per attribute, one column per SKU, with Attribute / attribute_akeneo / "Where to store" columns) into the TWO OriginFlow import files — attribute definitions (import first) and transposed SKU values (import second). Use when preparing a category's attributes and SKUs for import into the OriginFlow app.
---

# prepare-category-import

Turns a raw Excel/CSV export for one product category into the two files the OriginFlow app
imports, in order of use:

1. **`<category>_attributes.csv`** → Admin → Categories → open the category → **Import from CSV**
   (creates the attribute definitions with groups, data types and options).
2. **`<category>_skus.csv`** → **SKU Catalog** → pick the category → **Bulk upload**
   (creates/updates the SKUs and their values). Import this **after** step 1.

The app's parsers are the contract; this skill produces output that round-trips through them:
- `src/utils/attribute-csv-import.utils.ts` (`parseAttributeCsv`)
- `src/utils/sku-csv-import.utils.ts` (`parseSkuCsv`)

## Input format (as provided by the user)
One sheet, **one row per attribute, one column per SKU**:
- Column **`Attribute`** — the human attribute name.
- Column **`attribute_akeneo`** — the Akeneo code (trusted as-is; it is the join key).
- Column **`Where to store`** — only rows whose value contains **`Akeneo`** are used.
- **SKU columns** — every column whose header starts with `100` (SKU numbers). Each cell is that
  attribute's value for that SKU.
- Optional: a group/section column (`group`/`section`/`family`) is used for grouping if present;
  otherwise attributes default to the "Category Specific" group.
- Optional: a row named `Title`/`Name`/`Product name` becomes the SKU titles.

## Usage
```bash
python3 .claude/skills/prepare-category-import/prepare_category_import.py \
  "<input.xlsx|input.csv>" --category "<Category Name>" [--out-dir docs] [--sku-prefix 100]
```
For `.xlsx` input you need openpyxl once: `pip install openpyxl` (CSV needs nothing).

It writes both CSVs, prints a summary (attributes kept, types inferred, SKUs found) and a list of
warnings (derived/blank Akeneo codes, columns it couldn't classify, prose-looking options,
duplicate or malformed SKU numbers), and validates that every code in the SKU file exists in the
attributes file.

## Output details
**Attributes CSV** header (exact): `Attribute,Type,Akeneo Code,Suggested Data Type,Options / Range,Notes`
- `Type` uses labels the app maps: `1 . Category Specific Attributes`, `2. Standard Specs`,
  `3. Product Dimensions`, `4. Battery Information`, `5. Packaging`, `Category & Segmentation`,
  `Listing & Data` (default: `1 . Category Specific Attributes`).
- `Suggested Data Type` inferred from values: `Simple select` | `Number` | `Number (integer)` |
  `Boolean (Yes/No)` | `Text`.
- `Options / Range`: distinct values joined with `; ` for selects; `Observed range: min–max` for numbers.

**SKU values CSV** (transposed): first column header `Attribute`; remaining headers are SKU numbers.
Row 1 after header = `Title` row; each following row starts with the **Akeneo code** then one value
per SKU. Only attributes present in the attributes CSV are included, so codes always match.
