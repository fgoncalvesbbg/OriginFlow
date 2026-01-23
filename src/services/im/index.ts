/**
 * IM (Instruction Manual) module
 * Template management and project IM generation
 */

export {
  getIMTemplates,
  getIMTemplateById,
  getIMTemplateByCategoryId,
  createIMTemplate,
  updateIMTemplate
} from './im-template.service';

export {
  getIMSections,
  saveIMSection,
  deleteIMSection
} from './im-section.service';

export {
  getProjectIM,
  saveProjectIM,
  deleteProjectIM
} from './project-im.service';
