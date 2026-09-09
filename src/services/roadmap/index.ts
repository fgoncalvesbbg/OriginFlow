/**
 * Roadmap Creator services (migration 167).
 *
 * `roadmap.service.ts` is the seam the whole port hangs on: it is the entire contract the board
 * components see, so swapping ProductToolkit's Express backend for the `db` port did not reach
 * them. `roadmap-mapping.ts` is the pure row translation behind it.
 */

export {
  canEditRoadmap,
  getRoadmapApprovers,
  getRoadmapCategories,
  getRoadmapBoard,
  getRoadmapImports,
  getRoadmapAudit,
  importRoadmapSkus,
  setRoadmapFlag,
  clearRoadmapFlag,
  setRoadmapFlagStatus,
  addRoadmapPlacer,
  updateRoadmapPlacer,
  removeRoadmapPlacer,
  addRoadmapAxisValue,
  removeRoadmapAxisValue,
  clearRoadmapCategory,
} from './roadmap.service';

export {
  toImportRows,
  toAttrsJson,
  fromAttrsJson,
  fromSkuRow,
  fromFlagRow,
  fromPlacerRow,
  fromAxisValueRow,
  fromImportRow,
  fromAuditRow,
} from './roadmap-mapping';

export type { RoadmapImportRow } from './roadmap-mapping';
