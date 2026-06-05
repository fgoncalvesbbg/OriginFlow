-- Migration 57: make remaining project children cascade on project delete.
-- Admins can now delete a project from the admin dashboard, which must remove
-- every linked row. Most child tables (project_skus, project_attribute_requests,
-- project_steps, project_documents + its document_versions/document_comments,
-- project_comments, production_updates, im_publish_snapshots) already had
-- ON DELETE CASCADE. Two foreign keys were still NO ACTION and blocked the
-- delete: compliance_requests and project_ims. This migration switches both to
-- ON DELETE CASCADE so a single `delete from projects` removes all linked
-- SKUs, attributes, compliance requests and instruction manuals.

ALTER TABLE compliance_requests
  DROP CONSTRAINT IF EXISTS compliance_requests_project_id_fkey,
  ADD  CONSTRAINT compliance_requests_project_id_fkey
       FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;

ALTER TABLE project_ims
  DROP CONSTRAINT IF EXISTS project_ims_project_id_fkey,
  ADD  CONSTRAINT project_ims_project_id_fkey
       FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
