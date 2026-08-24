/**
 * The printed column's geometry for the content being edited, or null when the screen does not
 * know which profile applies.
 *
 * WHY the editor needs this. Authors were sizing an image, exporting, finding it had changed
 * size, and coming back to adjust — repeatedly. The print column has a FIXED width relative to
 * the body size (128mm at 7pt is 51.8em on A5) whereas the editor canvas is fluid, so the same
 * image occupied a different fraction of the column depending on window size, and a pixel width
 * was out by up to 2.5x. Handing the editor the real numbers lets it model them exactly.
 *
 * The result is cached per profile because the surface mounts once per language tab per box:
 * without it, opening a section with five languages would fire five identical queries.
 */

import { useEffect, useState } from 'react';
import type { IMTemplateType } from '../../../types';
import { getPrintTypography } from '../../../services/im/im-print-settings.service';
import { printColumnGeometry, type PrintColumnGeometry } from '../../../services/im/im-print-geometry';
import type { PrintPageSizeKey } from '../../../services/im/im-print-typography';

const cache = new Map<string, Promise<PrintColumnGeometry>>();

const geometryFor = (templateType: IMTemplateType, pageSize: PrintPageSizeKey) => {
  const key = `${templateType}::${pageSize}`;
  const hit = cache.get(key);
  if (hit) return hit;
  // getPrintTypography already falls back to the built-in profile when the row is unreachable,
  // so this resolves to usable geometry either way.
  const pending = getPrintTypography(templateType, pageSize).then((t) => printColumnGeometry(pageSize, t));
  // A rejected promise must not be cached, or one transient failure disables the preview for the
  // rest of the session.
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  return pending;
};

export const usePrintColumn = (
  templateType?: IMTemplateType,
  pageSize?: PrintPageSizeKey,
): PrintColumnGeometry | null => {
  const [geometry, setGeometry] = useState<PrintColumnGeometry | null>(null);

  useEffect(() => {
    if (!templateType || !pageSize) {
      setGeometry(null);
      return;
    }
    let alive = true;
    geometryFor(templateType, pageSize)
      .then((g) => { if (alive) setGeometry(g); })
      // Leaves the editor on its fluid canvas — what it did before this existed, never a broken
      // editing surface.
      .catch(() => {});
    return () => { alive = false; };
  }, [templateType, pageSize]);

  return geometry;
};
