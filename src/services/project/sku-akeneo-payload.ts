/**
 * Shapes a SKU's captured attribute values into the outbound payload that ProductToolkit
 * (and anything else speaking Akeneo codes) consumes.
 *
 * This is the REVERSE direction of producttoolkit-attributes.service.ts: that one pulls
 * "which attributes should this category have"; this one answers "what did we actually
 * capture for this SKU". The join key is the same in both directions — the Akeneo code.
 *
 * Deliberately pure and dependency-free (type-only imports, no env, no DB, no fetch) so it
 * can be unit-tested here AND bundled into the Netlify function that serves it —
 * see netlify/functions/sku-attributes.ts.
 */

/** A stored entry of project_skus.attribute_values. */
export interface StoredSkuValue {
  attributeId: string;
  name?: string;
  value?: string;
  type?: string;
}

/** The attribute rows needed to resolve a value to its Akeneo code. */
export interface AttributeLookupRow {
  id: string;
  akeneo_id: string | null;
  name: string;
  group: string;
  data_type?: string | null;
}

export interface SkuRow {
  id: string;
  sku_number: string;
  sku_title: string | null;
  category_id: string | null;
  attribute_values: StoredSkuValue[] | null;
  is_final?: boolean | null;
  pending_export?: boolean | null;
  last_exported_at?: string | null;
  updated_at?: string | null;
}

export interface SkuAttributePayload {
  skuNumber: string;
  skuTitle: string | null;
  categoryId: string | null;
  categoryName: string | null;
  isFinal: boolean;
  pendingExport: boolean;
  lastExportedAt: string | null;
  updatedAt: string | null;
  /** Captured values keyed by Akeneo code. Only attributes that HAVE a code appear here. */
  attributes: Record<string, string>;
  /**
   * Values that could not be expressed as an Akeneo code, so the consumer knows the payload
   * is partial rather than assuming the SKU simply has no such data. Two causes:
   *  - 'no-akeneo-code': the attribute exists but carries no code.
   *  - 'unknown-attribute': the stored attributeId matches no attribute at all (the value was
   *    captured against a definition that has since been deleted).
   */
  unmapped: { attributeId: string; name: string | null; reason: 'no-akeneo-code' | 'unknown-attribute' }[];
}

/**
 * Build the payload for one SKU.
 *
 * Empty-string values are omitted: a captured-but-blank field is not a value, and emitting
 * `""` would let the consumer overwrite good upstream data with nothing. A caller that needs
 * to distinguish "blank" from "absent" should read `unmapped` plus the category definition.
 *
 * When two stored entries resolve to the same Akeneo code, the LAST non-empty one wins. That
 * only happens with duplicate definitions, which the import path now prevents.
 */
export const buildSkuAttributePayload = (
  sku: SkuRow,
  attributesById: Map<string, AttributeLookupRow>,
  categoryName: string | null = null,
): SkuAttributePayload => {
  const attributes: Record<string, string> = {};
  const unmapped: SkuAttributePayload['unmapped'] = [];

  for (const entry of sku.attribute_values ?? []) {
    if (!entry?.attributeId) continue;
    const attr = attributesById.get(entry.attributeId);
    const value = (entry.value ?? '').trim();

    if (!attr) {
      unmapped.push({ attributeId: entry.attributeId, name: entry.name ?? null, reason: 'unknown-attribute' });
      continue;
    }
    const code = (attr.akeneo_id ?? '').trim();
    if (!code) {
      unmapped.push({ attributeId: entry.attributeId, name: attr.name, reason: 'no-akeneo-code' });
      continue;
    }
    if (!value) continue; // captured but blank — not a value
    attributes[code] = value;
  }

  return {
    skuNumber: sku.sku_number,
    skuTitle: sku.sku_title ?? null,
    categoryId: sku.category_id ?? null,
    categoryName,
    isFinal: sku.is_final === true,
    pendingExport: sku.pending_export === true,
    lastExportedAt: sku.last_exported_at ?? null,
    updatedAt: sku.updated_at ?? null,
    attributes,
    unmapped,
  };
};

/** Index attribute rows by id for the lookup above. */
export const indexAttributes = (rows: AttributeLookupRow[]): Map<string, AttributeLookupRow> =>
  new Map(rows.map(r => [r.id, r]));

/**
 * Overlay a supplier's latest 'submitted' attribute-request data onto a SKU's own stored
 * values, mirroring the in-app effective-value rule (getEffectiveSkuValue in
 * project-sku.service.ts): a submitted value wins when present, otherwise the SKU's own
 * value stands. Appending the submission after the SKU's own entries reuses
 * buildSkuAttributePayload's existing "last non-empty entry per code wins" behaviour to get
 * that rule for free — a blank submitted value is skipped there rather than clearing a good
 * stored one.
 *
 * Without this, a value a supplier has submitted but a PM has not yet reviewed onto the SKU
 * (via the ProjectDetail editor) is invisible to this payload, even though it is what a
 * consumer means by "what was actually captured for a SKU".
 */
export const withLatestSubmission = (
  values: StoredSkuValue[] | null | undefined,
  submittedData: StoredSkuValue[] | null | undefined,
): StoredSkuValue[] => [...(values ?? []), ...(submittedData ?? [])];
