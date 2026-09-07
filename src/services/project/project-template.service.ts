/**
 * Project templates — admin-defined standard document structure per phase for new projects.
 *
 * A project_template groups an ordered set of phases (template_steps) and, per phase, the
 * documents a launch of this type always needs (template_documents). createProject() (see
 * ./project.service) reads the default template and stamps its steps/documents onto every
 * new project — this used to be a hardcoded checklist there; now an admin edits it here
 * instead of it needing a code change. See db_migrations/152_project_phase_document_templates.sql.
 *
 * project_templates/template_steps/template_documents predate this feature but were unused
 * and RLS-locked (no policies) until that migration — the schema was already shaped for
 * exactly this.
 */

import { db, orEmpty, orUndefined, type Row } from '../../data';
import { isLive } from '../../config/environment.config';
import { ProjectTemplate, TemplateStep, TemplateDocument, ResponsibleParty } from '../../types';

const mapTemplate = (r: any): ProjectTemplate => ({
  id: r.id,
  name: r.name,
  description: r.description ?? undefined,
  isDefault: r.is_default ?? false,
  createdAt: r.created_at,
});

const mapStep = (r: any): TemplateStep => ({
  id: r.id,
  templateId: r.template_id,
  stepNumber: r.step_number,
  name: r.name,
});

const mapDocument = (r: any): TemplateDocument => ({
  id: r.id,
  templateId: r.template_id,
  stepNumber: r.step_number,
  title: r.title,
  description: r.description ?? undefined,
  responsibleParty: r.responsible_party,
  isVisibleToSupplier: r.is_visible_to_supplier,
  isRequired: r.is_required,
});

/** All templates, for the admin picker. */
export const getProjectTemplates = async (): Promise<ProjectTemplate[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('project_templates', { order: { column: 'name' } }),
    'getProjectTemplates',
  );
  return rows.map(mapTemplate);
};

/** The template createProject() will use. */
export const getDefaultProjectTemplate = async (): Promise<ProjectTemplate | undefined> => {
  if (!isLive) return undefined;
  const row = await orUndefined(
    db.selectMaybeOne<Row>('project_templates', { where: { is_default: true } }),
    'getDefaultProjectTemplate',
  );
  return row ? mapTemplate(row) : undefined;
};

export const saveProjectTemplate = async (
  template: Partial<ProjectTemplate> & { name: string },
): Promise<ProjectTemplate> => {
  const payload = {
    name: template.name.trim(),
    description: template.description?.trim() || null,
  };
  if (template.id) {
    return mapTemplate(await db.update<Row>('project_templates', payload, { where: { id: template.id } }));
  }
  return mapTemplate(await db.insert<Row>('project_templates', payload));
};

/** Deletes the template and its steps/documents (template_steps/template_documents cascade). */
export const deleteProjectTemplate = async (id: string): Promise<void> => {
  await db.delete('project_templates', { where: { id } });
};

/** Makes this template the one createProject() uses; clears the flag on every other template. */
export const setDefaultProjectTemplate = async (id: string): Promise<void> => {
  await db.updateWhere('project_templates', { is_default: false }, { where: { is_default: true } });
  await db.updateWhere('project_templates', { is_default: true }, { where: { id } });
};

export const getTemplateSteps = async (templateId: string): Promise<TemplateStep[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('template_steps', { where: { template_id: templateId }, order: { column: 'step_number' } }),
    'getTemplateSteps',
  );
  return rows.map(mapStep);
};

export const saveTemplateStep = async (
  step: Partial<TemplateStep> & { templateId: string; stepNumber: number; name: string },
): Promise<TemplateStep> => {
  const payload = { template_id: step.templateId, step_number: step.stepNumber, name: step.name.trim() };
  if (step.id) {
    return mapStep(await db.update<Row>('template_steps', payload, { where: { id: step.id } }));
  }
  return mapStep(await db.insert<Row>('template_steps', payload));
};

export const deleteTemplateStep = async (id: string): Promise<void> => {
  await db.delete('template_steps', { where: { id } });
};

export const getTemplateDocuments = async (templateId: string): Promise<TemplateDocument[]> => {
  if (!isLive) return [];
  const rows = await orEmpty(
    db.select<Row>('template_documents', { where: { template_id: templateId }, order: { column: 'step_number' } }),
    'getTemplateDocuments',
  );
  return rows.map(mapDocument);
};

export const saveTemplateDocument = async (
  doc: Partial<TemplateDocument> & { templateId: string; stepNumber: number; title: string },
): Promise<TemplateDocument> => {
  const payload = {
    template_id: doc.templateId,
    step_number: doc.stepNumber,
    title: doc.title.trim(),
    description: doc.description?.trim() || null,
    responsible_party: doc.responsibleParty ?? ResponsibleParty.INTERNAL,
    is_visible_to_supplier: doc.isVisibleToSupplier ?? true,
    is_required: doc.isRequired ?? true,
  };
  if (doc.id) {
    return mapDocument(await db.update<Row>('template_documents', payload, { where: { id: doc.id } }));
  }
  return mapDocument(await db.insert<Row>('template_documents', payload));
};

export const deleteTemplateDocument = async (id: string): Promise<void> => {
  await db.delete('template_documents', { where: { id } });
};

/** The full phase/document structure of the default template, ready to seed a new project. */
export const getDefaultTemplateStructure = async (): Promise<
  { templateId: string; steps: TemplateStep[]; documents: TemplateDocument[] } | undefined
> => {
  const template = await getDefaultProjectTemplate();
  if (!template) return undefined;
  const [steps, documents] = await Promise.all([
    getTemplateSteps(template.id),
    getTemplateDocuments(template.id),
  ]);
  return { templateId: template.id, steps, documents };
};
