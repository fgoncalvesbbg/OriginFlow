-- 166: link registry documents to a project template, so every new project starts with
--      the standard SOPs/guidelines already attached.
--
-- WHAT THIS ADDS, AND WHY IT IS NOT A COLUMN ON template_documents
-- ----------------------------------------------------------------
-- Project Templates (migration 152) already carry `template_documents` — but those are
-- SLOTS: "somebody must upload an RFQ Specification in phase 1". createProject() stamps
-- each one into `project_documents` with status 'not_started', and the project chases it
-- until a file lands.
--
-- A packaging guideline is the opposite kind of thing. It is a document we HAND DOWN, it
-- already exists, it is owned centrally, and the project must always see the current
-- release of it rather than a copy someone attached once. That is exactly what
-- `doc_bindings` (migration 159) already models: a binding names the DOCUMENT, never a
-- version, so it follows the final release forever with nothing to re-point.
--
-- So this table is the template-level equivalent of `doc_bindings`: it says which registry
-- documents a launch of this type always applies. createProject() reads it and writes the
-- corresponding `doc_bindings` rows for the new project. Nothing is copied — the project
-- gets a binding, and the binding resolves to whatever is final at read time.
--
-- Putting a `document_id` on `template_documents` instead would have conflated the two:
-- the stamped `project_documents` row would be an upload slot that is already satisfied by
-- a file nobody on the project owns, and un-finalising the version would have no way to
-- withdraw it.
--
-- Deliberately NOT per phase. `doc_bindings` has no step_number — an applicable document
-- applies to the project, not to one of its phases — and the project Documents tab and the
-- supplier portal both list bindings flat. Adding a phase here would be a column that
-- nothing downstream could honour.
--
-- SECURITY: this is a doc_* table, not a template_* one
-- -----------------------------------------------------
-- It references doc_documents, so it follows migration 159's rule rather than 152's:
-- SERVER-ONLY, reached exclusively through netlify/functions/doc-registry.ts
-- (/api/doc/templates/:templateId/documents). RLS enabled with no policies, PostgREST
-- grants revoked from anon and authenticated — default deny, twice over, exactly as every
-- other doc_* table.
--
-- The other three template tables (project_templates, template_steps, template_documents)
-- are read straight from the browser under "Auth read using (true)". Doing that here would
-- publish the set of registered document ids to every authenticated caller — and an
-- authenticated caller is not necessarily internal: doc-access.ts resolves any role
-- outside INTERNAL_ROLES as a SUPPLIER. The admin panel therefore joins titles through the
-- function, which returns the same whitelisted DTO the registry screen already gets.


create table if not exists public.template_doc_bindings (
  id          uuid primary key default gen_random_uuid(),

  template_id uuid not null references public.project_templates(id) on delete cascade,

  -- CASCADE, matching doc_bindings.document_id. Note doc_versions references
  -- doc_documents ON DELETE RESTRICT, so a document that has ever had a version cannot be
  -- deleted anyway — this only cleans up links to a registry entry created in error.
  document_id uuid not null references public.doc_documents(id) on delete cascade,

  created_by  uuid,
  created_at  timestamptz not null default now(),

  -- Linking the same document twice is a double click, not two links. The upsert in
  -- doc-registry.ts targets this constraint by name-shape (template_id,document_id).
  constraint template_doc_bindings_template_document_key unique (template_id, document_id)
);

comment on table public.template_doc_bindings is
  'Which registry documents a project template always applies. createProject() turns each row into a doc_bindings row for the new project, so the project sees the document''s CURRENT final version. Server-only: see the header of migration 159.';

-- The unique constraint already indexes (template_id, document_id), which serves the
-- per-template read. This one serves the other direction: "which templates hand this
-- document down", asked when a document is about to be retired.
create index if not exists template_doc_bindings_document_id_idx
  on public.template_doc_bindings (document_id);


-- ===========================================================================
-- RLS: enabled, no policies. Default deny. Then the grants, removed separately.
-- ===========================================================================

alter table public.template_doc_bindings enable row level security;
alter table public.template_doc_bindings force row level security;

revoke all on public.template_doc_bindings from anon, authenticated;


-- ===========================================================================
-- VERIFY
-- ===========================================================================
--
-- Default deny is real — expect "permission denied for table template_doc_bindings":
--   set local role anon;          select * from public.template_doc_bindings limit 1;
--   set local role authenticated; select * from public.template_doc_bindings limit 1;
--
-- No policies — expect zero rows:
--   select policyname from pg_policies
--    where schemaname = 'public' and tablename = 'template_doc_bindings';
--
-- RLS on and forced — expect (t, t):
--   select relrowsecurity, relforcerowsecurity from pg_class
--    where oid = 'public.template_doc_bindings'::regclass;
--
-- What the default template hands down — empty until an admin links something:
--   select t.name, d.title, d.audience,
--          (select v.label from doc_versions v
--            where v.document_id = d.id and v.is_final) as final_version
--     from template_doc_bindings b
--     join project_templates t on t.id = b.template_id
--     join doc_documents d     on d.id = b.document_id
--    where t.is_default
--    order by d.title;
