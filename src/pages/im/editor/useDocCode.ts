/**
 * The document code for the export being configured, e.g. `WL-RAN-ANGLED-8MJ-A5`.
 *
 * The code needs the category's L2 and L3 NAMES, which no screen has to hand — a template
 * carries only `categoryId`. So this resolves them once from the category tree and caches the
 * result for the session, the same shape `usePrintColumn` uses for the print profile: the
 * export dialogs mount and unmount repeatedly, and none of them should re-fetch 132 categories
 * to render one line of text.
 *
 * Returns '' until resolved (and if resolution fails), so a caller can render the code only
 * when there is one rather than showing a half-built identifier.
 */

import { useEffect, useState } from 'react';
import type { IMTemplateType } from '../../../types';
import { getCategories } from '../../../services';
import { buildDocCode } from '../../../services/im/im-doc-code';
import type { PrintPageSizeKey } from '../../../services/im/im-print-typography';

/** categoryId → the L2/L3 names the code is built from. Resolved once per session. */
let namesPromise: Promise<Map<string, { l2Name: string | null; l3Name: string }>> | null = null;

const categoryNames = () => {
  if (namesPromise) return namesPromise;
  namesPromise = getCategories()
    .then((rows) => new Map(rows.map((c) => [c.id, { l2Name: c.l2Name ?? null, l3Name: c.name }])))
    // A rejected promise must not be cached, or one transient failure hides the code for the
    // rest of the session.
    .catch((e) => {
      namesPromise = null;
      throw e;
    });
  return namesPromise;
};

/**
 * A resolver for LISTS — coverage rows and history rows span many categories, so each needs its
 * own code and one hook call per row is not an option.
 *
 * Returns a function that yields '' until the category names have loaded, so a table renders
 * without a blank column flashing into place, and never throws for an unknown category.
 */
export const useDocCodeResolver = (): ((
  templateType: IMTemplateType | string,
  pageSize: string,
  categoryId: string | null | undefined,
) => string) => {
  const [byId, setById] = useState<Map<string, { l2Name: string | null; l3Name: string }> | null>(null);

  useEffect(() => {
    let alive = true;
    categoryNames()
      .then((m) => { if (alive) setById(m); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  return (templateType, pageSize, categoryId) => {
    if (!byId || !categoryId) return '';
    const names = byId.get(categoryId);
    return buildDocCode({ templateType, pageSize, categoryId, l2Name: names?.l2Name, l3Name: names?.l3Name });
  };
};

export const useDocCode = (
  templateType: IMTemplateType | undefined,
  pageSize: PrintPageSizeKey | undefined,
  categoryId: string | null | undefined,
): string => {
  const [code, setCode] = useState('');

  useEffect(() => {
    if (!templateType || !pageSize || !categoryId) {
      setCode('');
      return;
    }
    let alive = true;
    categoryNames()
      .then((byId) => {
        if (!alive) return;
        const names = byId.get(categoryId);
        setCode(
          buildDocCode({
            templateType,
            pageSize,
            categoryId,
            l2Name: names?.l2Name,
            l3Name: names?.l3Name,
          }),
        );
      })
      // Leaves the code blank — the dialog simply does not show one, which is honest.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [templateType, pageSize, categoryId]);

  return code;
};
