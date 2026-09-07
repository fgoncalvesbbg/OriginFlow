-- 144: cascade the projects RLS scoping to project-owned child tables.
-- APPLIED to production 2026-09-05.
--
-- `projects` already restricts PMs to their own rows (pm_id = auth.uid()) while admins
-- see everything, but every child table below was `TO authenticated USING (true)`, so a
-- PM who could not see a project could still read and edit its SKUs, mint a public share
-- link for its manual, and read its supplier submissions. This closes that gap by routing
-- every child policy through one helper.
--
-- Deliberately NOT scoped here:
--   * im_tm_reuse_log      - org-wide translation-memory analytics, shared asset.
--   * project_skus with project_id IS NULL - the project-less catalog SKUs that
--     getCatalogSkus()/SkuCatalog reads unfiltered; they belong to no project.
-- Anon portal access is unaffected: it runs through SECURITY DEFINER RPCs, and the
-- Netlify functions use the service-role key. Both bypass RLS by design.
--
-- Verified after apply: admins 14 projects/153 skus/6 shares (unchanged);
-- the single PM 1 project/113 skus (111 of them catalog)/0 shares (was 14/153/6).
--
-- ROLLBACK: drop the "Scoped *" policies and recreate each as
--   create policy "Auth all" on <tbl> for all to authenticated using (true) with check (true);
-- (or the per-command Auth select/insert/update/delete shape listed per table below).

create or replace function public.can_see_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_project_id is not null and exists (
    select 1
    from public.projects pr
    where pr.id = p_project_id
      and (
        exists (select 1 from public.profiles pf
                 where pf.id = auth.uid() and upper(pf.role) = 'ADMIN')
        or pr.pm_id = auth.uid()
      )
  );
$$;

comment on function public.can_see_project(uuid) is
  'RLS helper: true when the calling user may see the given project (admin, or the assigned PM). SECURITY DEFINER so child-table policies do not recurse through projects RLS. Mirrors the projects policies from migration 81.';

revoke execute on function public.can_see_project(uuid) from public, anon;
grant execute on function public.can_see_project(uuid) to authenticated;

-- project_skus: keep project-less catalog SKUs org-wide, scope the rest.
-- (was: Auth select/insert/update/delete, each USING/WITH CHECK true)
drop policy if exists "Auth select" on public.project_skus;
drop policy if exists "Auth insert" on public.project_skus;
drop policy if exists "Auth update" on public.project_skus;
drop policy if exists "Auth delete" on public.project_skus;
create policy "Scoped select" on public.project_skus for select to authenticated
  using (project_id is null or public.can_see_project(project_id));
create policy "Scoped insert" on public.project_skus for insert to authenticated
  with check (project_id is null or public.can_see_project(project_id));
create policy "Scoped update" on public.project_skus for update to authenticated
  using (project_id is null or public.can_see_project(project_id))
  with check (project_id is null or public.can_see_project(project_id));
create policy "Scoped delete" on public.project_skus for delete to authenticated
  using (project_id is null or public.can_see_project(project_id));

-- im_shares (project_id NOT NULL) -- was: Auth all
drop policy if exists "Auth all" on public.im_shares;
create policy "Scoped all" on public.im_shares for all to authenticated
  using (public.can_see_project(project_id))
  with check (public.can_see_project(project_id));

-- im_review_comments -- was: Auth all
drop policy if exists "Auth all" on public.im_review_comments;
create policy "Scoped all" on public.im_review_comments for all to authenticated
  using (public.can_see_project(project_id))
  with check (public.can_see_project(project_id));

-- im_regulatory_checklist_state -- was: Auth all
drop policy if exists "Auth all" on public.im_regulatory_checklist_state;
create policy "Scoped all" on public.im_regulatory_checklist_state for all to authenticated
  using (public.can_see_project(project_id))
  with check (public.can_see_project(project_id));

-- im_print_renders (select + insert only) -- was: Auth select/insert
drop policy if exists "Auth select" on public.im_print_renders;
drop policy if exists "Auth insert" on public.im_print_renders;
create policy "Scoped select" on public.im_print_renders for select to authenticated
  using (public.can_see_project(project_id));
create policy "Scoped insert" on public.im_print_renders for insert to authenticated
  with check (public.can_see_project(project_id));

-- project_attribute_requests (select + insert + update only)
drop policy if exists "Auth select" on public.project_attribute_requests;
drop policy if exists "Auth insert" on public.project_attribute_requests;
drop policy if exists "Auth update" on public.project_attribute_requests;
create policy "Scoped select" on public.project_attribute_requests for select to authenticated
  using (public.can_see_project(project_id));
create policy "Scoped insert" on public.project_attribute_requests for insert to authenticated
  with check (public.can_see_project(project_id));
create policy "Scoped update" on public.project_attribute_requests for update to authenticated
  using (public.can_see_project(project_id))
  with check (public.can_see_project(project_id));
