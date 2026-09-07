-- 152: admin-configurable standard document structure per project phase.
--
-- project_templates / template_steps / template_documents already existed live — flagged as
-- dead (0 rows, RLS enabled but zero policies, so unreachable either way) and listed as a
-- drop candidate in 150_audit_remediation.sql's Part C5. They are exactly the shape this
-- feature needs (a template groups ordered phases, each phase carries its required
-- documents), so this resurrects them instead of adding new tables. 150's C5 has been
-- updated to stop listing them.
--
-- createProject() (src/services/project/project.service.ts) used to hardcode 3 phases and
-- 7 documents. It now reads the default template (src/services/project/project-template.service.ts)
-- at project-creation time and stamps that structure onto the new project's project_steps /
-- project_documents — unrelated existing tables that stay exactly as they were. The seed
-- below reproduces the previous hardcoded checklist verbatim as that default template, so
-- behaviour is unchanged until an admin edits it under Admin panel > Project Templates.


-- =====================================================================
-- Only one template may be the default at a time.
-- =====================================================================
create unique index if not exists project_templates_one_default
  on public.project_templates ((is_default))
  where is_default = true;

-- One step-number / title per phase inside a template.
create unique index if not exists template_steps_template_step_uidx
  on public.template_steps (template_id, step_number);


-- =====================================================================
-- RLS — same reference-table pattern as im_markets / regulation_clauses:
-- admins manage the templates, every authenticated user can read them (createProject runs
-- as whichever PM is creating the project, not as an admin).
-- =====================================================================

create policy "Admin write" on public.project_templates for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = 'ADMIN'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = 'ADMIN'));

create policy "Auth read" on public.project_templates for select to authenticated using (true);

create policy "Admin write" on public.template_steps for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = 'ADMIN'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = 'ADMIN'));

create policy "Auth read" on public.template_steps for select to authenticated using (true);

create policy "Admin write" on public.template_documents for all to authenticated
  using (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = 'ADMIN'))
  with check (exists (select 1 from profiles p where p.id = auth.uid() and upper(p.role) = 'ADMIN'));

create policy "Auth read" on public.template_documents for select to authenticated using (true);


-- =====================================================================
-- Seed: the default template, reproducing the structure createProject() used to hardcode.
-- =====================================================================

insert into public.project_templates (id, name, description, is_default)
values (
  'a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601',
  'Standard Launch Process',
  'Default phase and document structure for new projects. Used by createProject() whenever no other template is marked default.',
  true
);

insert into public.template_steps (template_id, step_number, name) values
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 1, 'RFQ'),
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 2, 'Business Case & Development'),
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 3, 'Production');

insert into public.template_documents (template_id, step_number, title, responsible_party, is_visible_to_supplier, is_required) values
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 1, 'RFQ Specification',      'internal', true, true),
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 1, 'Supplier Quote',         'supplier', true, true),
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 2, '3D CAD Files',           'supplier', true, true),
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 2, 'Product Photos',         'supplier', true, true),
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 3, 'Final Design Specs',     'internal', true, true),
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 3, 'Final IM',               'supplier', true, true),
  ('a2f3b1c4-5d6e-4f70-8a91-b2c3d4e5f601', 3, 'Packaging Guidelines',   'internal', true, true);


-- =====================================================================
-- VERIFY
-- =====================================================================
-- Expect the 7-row seed above, one default template:
--   select t.name, t.is_default, count(distinct s.id) steps, count(d.id) docs
--     from project_templates t
--     left join template_steps s on s.template_id = t.id
--     left join template_documents d on d.template_id = t.id
--    group by t.id, t.name, t.is_default;
--
-- Expect a non-admin authenticated role to read but not write:
--   set local role authenticated;
--   select count(*) from project_templates; -- 1
