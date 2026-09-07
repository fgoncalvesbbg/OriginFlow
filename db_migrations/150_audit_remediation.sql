-- 150_audit_remediation.sql
--
-- Remediation for the 2026-09-07 Supabase audit (see SUPABASE_AUDIT_2026-09-07.md).
-- NOTHING IN THIS FILE HAS BEEN APPLIED.
--
-- Part A is safe to run as-is: no app-visible behaviour changes, no deploy needed.
-- Part B destroys data (plaintext credentials) — read the note before running.
-- Part C is left COMMENTED OUT: each item needs a code deploy or a product decision first.
--
-- Verify afterwards with the queries at the bottom.


-- =====================================================================
-- PART A — safe now. No deploy, no user-visible change.
-- =====================================================================

-- A1 (audit S1, enumeration half) -------------------------------------
-- Stop anonymous callers from LISTING every object in the public buckets.
--
-- Why this is safe: a public bucket is downloaded through /object/public/<bucket>/<path>,
-- which does not consult storage.objects RLS at all. These SELECT policies only govern the
-- storage LIST/metadata API. Narrowing them from `public` (which includes anon) to
-- `authenticated` leaves every existing viewer, share link and print download working, while
-- removing an unauthenticated caller's ability to discover the 485 object paths.
--
-- The authenticated grant is kept because the app really does list: see
-- src/services/im/im-asset-library.service.ts:149 (imports objects under im-assets/library/).

drop policy if exists "im-assets public read"    on storage.objects;
drop policy if exists "im-published public read" on storage.objects;
drop policy if exists "im-print public read"     on storage.objects;

create policy "im-assets authenticated list"
  on storage.objects for select to authenticated
  using (bucket_id = 'im-assets');

create policy "im-published authenticated list"
  on storage.objects for select to authenticated
  using (bucket_id = 'im-published');

create policy "im-print authenticated list"
  on storage.objects for select to authenticated
  using (bucket_id = 'im-print');


-- A2 (audit S4) -------------------------------------------------------
-- Two policies reference an `images` bucket that does not exist. Dead rules.

drop policy if exists "Public Access" on storage.objects;
drop policy if exists "Auth Upload"   on storage.objects;


-- A3 (audit S6) -------------------------------------------------------
-- The flreew_0..3 set duplicates the four "Authenticated users can ..." policies on
-- `documents`, with an extra `private/` folder condition that grants nothing extra.
-- Dropping them leaves the four named policies as the single source of truth.

drop policy if exists "Give users authenticated access to folder flreew_0" on storage.objects;
drop policy if exists "Give users authenticated access to folder flreew_1" on storage.objects;
drop policy if exists "Give users authenticated access to folder flreew_2" on storage.objects;
drop policy if exists "Give users authenticated access to folder flreew_3" on storage.objects;


-- A4 (audit D6) -------------------------------------------------------
-- Two finalization guards were missed by migration 72's search_path sweep.

alter function public.im_sections_finalized_guard()  set search_path = public, pg_temp;
alter function public.im_templates_finalized_guard() set search_path = public, pg_temp;


-- A5 (audit D7) -------------------------------------------------------
-- handle_tcf_submission / _v2 are SECURITY DEFINER trigger functions attached to no
-- trigger, with EXECUTE granted to anon. Postgres refuses to invoke a trigger function
-- over RPC so they are not exploitable, but they are dead surface the advisor keeps
-- flagging. Revoke first; drop only if the guard block below confirms no trigger uses them.

do $$
begin
  if exists (
    select 1 from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
    where p.proname in ('handle_tcf_submission', 'handle_tcf_submission_v2')
  ) then
    raise exception 'handle_tcf_submission* IS attached to a trigger - do not drop';
  end if;
end $$;

drop function if exists public.handle_tcf_submission();
drop function if exists public.handle_tcf_submission_v2();

-- The remaining trigger functions stay (they are attached and in use), but nothing should
-- be able to reach them over PostgREST.
revoke execute on function public.enforce_profile_role_guard()      from anon, authenticated;
revoke execute on function public.ensure_access_code()              from anon, authenticated;
revoke execute on function public.handle_new_user()                 from anon, authenticated;
revoke execute on function public.im_sections_finalized_guard()     from anon, authenticated;
revoke execute on function public.im_templates_finalized_guard()    from anon, authenticated;
revoke execute on function public.im_tm_segments_governance_guard() from anon, authenticated;
revoke execute on function public.project_ims_finalized_guard()     from anon, authenticated;


-- =====================================================================
-- PART B — destroys data on purpose. Read this first.
-- =====================================================================

-- B1 (audit D4) -------------------------------------------------------
-- supplier_access_logs.access_code holds 101 rows / 9 distinct plaintext 6-digit supplier
-- access codes. THREE of them still match live rows in `suppliers`.
--
-- ROTATE THOSE THREE CODES FIRST, or you are only hiding evidence of a credential that
-- is still valid. This query names the suppliers whose code is exposed:
--
--   select distinct s.id, s.name
--   from suppliers s
--   where exists (select 1 from supplier_access_logs l where l.access_code = s.access_code);
--
-- Then run the purge. The log keeps its forensic value (which supplier, when, success/fail);
-- only the credential itself goes.

alter table public.supplier_access_logs
  add column if not exists code_fingerprint text;

-- pgcrypto lives in the `extensions` schema on this project, so digest() must be qualified.
update public.supplier_access_logs
   set code_fingerprint =
         left(encode(extensions.digest(coalesce(access_code, ''), 'sha256'), 'hex'), 12)
 where access_code is not null;

alter table public.supplier_access_logs drop column access_code;

-- The anon INSERT policy on this table is WITH CHECK (true) — unauthenticated log spam.
-- Rate limiting now lives in portal_rl_guard / portal_access_attempts, so the anon write
-- is no longer load-bearing.
drop policy if exists "Allow unauthenticated access to insert logs" on public.supplier_access_logs;


-- =====================================================================
-- PART C — do NOT run yet. Each needs a deploy or a decision first.
-- =====================================================================

-- C1 (audit S1, download half) ----------------------------------------
-- Flip the two IM buckets private. PREREQUISITE: netlify/functions/im-file-url.ts must be
-- DEPLOYED and verified against a published manual, a print PDF and the supplier portal.
-- Flipping before the deploy breaks the live viewer and the entire print pipeline.
--
-- update storage.buckets set public = false where id in ('im-published', 'im-print');

-- C2 (audit S2) -------------------------------------------------------
-- launchflow-docs: dead bucket, public, no size limit, no MIME allowlist, anon INSERT.
-- Zero references in src/, netlify/ or scripts/. Download the 5 objects first if anyone
-- wants them, then either lock it down or delete it outright.
--
-- drop policy if exists "Public Supplier Uploads" on storage.objects;
-- drop policy if exists "Public Read Access"      on storage.objects;
-- update storage.buckets
--    set public = false, file_size_limit = 10485760,
--        allowed_mime_types = array['image/png','image/jpeg','image/webp','application/pdf']
--  where id = 'launchflow-docs';

-- C3 (audit S3) -------------------------------------------------------
-- im-review-uploads. PREREQUISITE: src/services/im/im-review-comments.service.ts:193
-- (reviewImageUrl -> storage.publicUrl) must become an async signed-URL call, and every
-- call site awaited. The bucket is empty today, so this is cheap right now.
--
-- update storage.buckets set public = false where id = 'im-review-uploads';

-- C4 (audit D1 / D2 / S5) ---------------------------------------------
-- The portal RPC refactor. anon_select_visible_docs returns 111 of 113 rows to any
-- anonymous caller because is_visible_to_supplier carries no project or token binding;
-- anon_select_doc_comments is USING (true); and the documents-bucket anon INSERT has no
-- folder scoping. All three close together once supplier reads and writes go through
-- token-scoped SECURITY DEFINER RPCs (the pattern already used by get_project_by_token_secure)
-- and a signed-upload function (the pattern already used by review-upload-url.ts).
--
-- drop policy if exists "anon_select_visible_docs"      on public.project_documents;
-- drop policy if exists "anon_select_doc_comments"      on public.document_comments;
-- drop policy if exists "Anon users can upload documents" on storage.objects;

-- C5 (audit §3) -------------------------------------------------------
-- Archive-then-drop the dead tables, following migration 145's pattern. All have 0 rows
-- and (at audit time) no reference in src/, netlify/ or scripts/. Drop in FK order.
--
-- UPDATE 2026-09-07: template_documents / template_steps / project_templates are NO LONGER
-- dead — migration 152 put them into use as the admin-configurable "standard documents per
-- phase" structure createProject() reads from. Do not archive or drop them.
--
-- create schema if not exists private_archive;
-- create table private_archive.project_comments_150           as select * from public.project_comments;
-- create table private_archive.product_features_150           as select * from public.product_features;
-- create table private_archive.im_library_images_150          as select * from public.im_library_images;
-- create table private_archive.im_regulatory_check_units_150  as select * from public.im_regulatory_check_units;
-- drop table public.project_comments, public.product_features;
-- drop table public.im_library_images, public.im_regulatory_check_units;

-- C6 (audit §4) -------------------------------------------------------
-- im_publish_snapshots is 116 MB / 722 rows for 10 IMs; 604 of those rows are superseded
-- versions of the 118 current ones. Decide the retention window first (keep last N per
-- project x language x template_type, or last N days) — this deletes publish history.
--
-- with keep as (
--   select id from (
--     select id, row_number() over (
--       partition by project_id, language, template_type order by published_at desc) rn
--     from im_publish_snapshots) q where rn <= 3)
-- delete from im_publish_snapshots where id not in (select id from keep);
-- vacuum full im_publish_snapshots;

-- C7 (audit §4) -------------------------------------------------------
-- Five non-unique indexes have never been scanned. The im_tm_reuse_log pair is the only
-- meaningful size (1.5 MB) and that table is the fastest-growing in the database.
--
-- drop index if exists idx_im_tm_reuse_log_locale_time;
-- drop index if exists idx_im_tm_reuse_log_domain;
-- drop index if exists idx_im_tm_segments_reg_refs;
-- drop index if exists im_blocks_categories_gin;
-- drop index if exists idx_regulations_categories;


-- =====================================================================
-- VERIFY (run after Part A + B)
-- =====================================================================
-- Expect zero rows: no anon-listable storage objects.
--   set local role anon; select bucket_id, count(*) from storage.objects group by 1;
--
-- Expect zero rows: no policy referencing the non-existent images bucket.
--   select policyname from pg_policies
--    where schemaname = 'storage' and (qual like '%images%' or with_check like '%images%');
--
-- Expect 'f': access_code column is gone.
--   select exists (select 1 from information_schema.columns
--                   where table_name = 'supplier_access_logs' and column_name = 'access_code');
--
-- Expect the two guards to report a pinned search_path.
--   select proname, proconfig from pg_proc
--    where proname in ('im_sections_finalized_guard', 'im_templates_finalized_guard');
