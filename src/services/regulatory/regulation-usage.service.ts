/**
 * "Who answers for this regulation?" — both halves, in one read.
 *
 * The point of merging the TCF's and the IM's views of a regulation (migration 139) is
 * that a person can finally see the whole obligation in one place: the evidence suppliers
 * are asked for AND the manual content it dictates. That question spans two subsystems
 * that share nothing but the regulation id, so it is answered here rather than in either.
 *
 * The IM half reproduces the union rule from regulation-assignment.service.ts — explicit
 * `im_template_regulations` rows PLUS every template whose category is ticked on the
 * regulation — because a template covered only by its category has no row and would
 * otherwise be invisible on a page whose whole job is to be complete.
 */

import { db, orEmpty, withDeadline, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import type { ComplianceRequirement, IMTemplateType } from '../../types';
import { getComplianceRequirements } from '../compliance/compliance-requirement.service';
import { getRegulationById } from './regulation.service';

const TAG = '[regulatory]';
const READ_TIMEOUT_MS = 12000;

/** One IM template that answers for the regulation, and why. */
export interface RegulationTemplateUse {
  templateId: string;
  name: string;
  categoryId: string | null;
  templateType: IMTemplateType;
  /** 'explicit' = assigned to this template; 'category' = derived from a ticked category. */
  source: 'explicit' | 'category';
}

export interface RegulationUsage {
  /** TCF requirements citing the regulation, in the order the library shows them. */
  tcfRequirements: ComplianceRequirement[];
  templates: RegulationTemplateUse[];
}

/**
 * Everything that cites one regulation.
 *
 * Reads the whole requirement and template tables and filters in memory. That is the right
 * shape here and not laziness: both tables are in the tens-to-hundreds of rows, the same
 * two reads already back the library's count badges, and filtering server-side would need
 * a PostgREST-specific `or` across two different join paths — work src/data/PORTING.md
 * counts against any non-PostgREST adapter.
 */
export const getRegulationUsage = async (regulationId: string): Promise<RegulationUsage> => {
  if (!regulationId || !isLive) return { tcfRequirements: [], templates: [] };

  const [requirements, regulation, assignments, templates] = await Promise.all([
    getComplianceRequirements(),
    getRegulationById(regulationId),
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('im_template_regulations', {
          columns: 'template_id,regulation_id',
          where: { regulation_id: regulationId },
          signal,
        }),
        READ_TIMEOUT_MS,
        'getRegulationUsage:assignments',
      ),
      `${TAG} getRegulationUsage`,
    ),
    orEmpty(
      withDeadline(
        (signal) => db.select<Row>('im_templates', {
          columns: 'id,name,category_id,template_type',
          signal,
        }),
        READ_TIMEOUT_MS,
        'getRegulationUsage:templates',
      ),
      `${TAG} getRegulationUsage`,
    ),
  ]);

  const explicitIds = new Set(assignments.map((a: any) => a.template_id));
  const categories = new Set(regulation?.applicableCategories ?? []);

  const uses: RegulationTemplateUse[] = [];
  for (const t of templates as any[]) {
    const explicit = explicitIds.has(t.id);
    // A superseded regulation stops applying by category but keeps its explicit rows —
    // the same asymmetry getTemplateRegulations enforces, mirrored here so this page does
    // not claim a retired regulation still governs a category's templates.
    const byCategory = regulation?.status !== 'superseded' && !!t.category_id && categories.has(t.category_id);
    if (!explicit && !byCategory) continue;
    uses.push({
      templateId: t.id,
      name: t.name,
      categoryId: t.category_id ?? null,
      templateType: t.template_type as IMTemplateType,
      source: explicit ? 'explicit' : 'category',
    });
  }
  uses.sort((a, b) => a.name.localeCompare(b.name));

  return {
    tcfRequirements: requirements
      .filter(r => r.regulationId === regulationId)
      .sort((a, b) => (a.section ?? '').localeCompare(b.section ?? '') || a.title.localeCompare(b.title)),
    templates: uses,
  };
};
