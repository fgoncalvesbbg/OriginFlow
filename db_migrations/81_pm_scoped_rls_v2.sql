-- Migration 81: PM-scoped RLS (v2) — supersedes the never-applied migration 36.
--
-- Replaces the "Enable all for authenticated" full-access policies on internal
-- tables with admin-full + PM-scoped access, closing the hole where ANY
-- authenticated account could read/write ALL projects/suppliers/proposals.
--
-- Differences from migration 36 (which must NOT be applied — its lines 289-443
-- recreate anon/public portal policies that migrations 71/74/78 intentionally removed):
--   * AUTHENTICATED policies ONLY. No anon/public policies are created here, so the
--     supplier-portal lockdowns (71/74/75/78) and anon_select_visible_docs are preserved.
--   * Role checks are CASE-INSENSITIVE (upper(role)) — prod stores the PM role as 'pm'.
--   * Suppliers & supplier_proposals are PROJECT-LINKED: a PM sees rows tied to their
--     own projects (projects.supplier_id) OR via explicit supplier_pm_assignments, so
--     the (currently empty) assignments table does not lock PMs out.
--
-- NOTE: a PM sees only projects where projects.pm_id = their uid (+ cascading steps/
-- docs/compliance/production), their own rfqs (created_by), and project-linked
-- suppliers/proposals. Admins (upper(role)='ADMIN') retain full access.

-- ===================== PROJECTS =====================
DROP POLICY IF EXISTS "Enable all for projects" ON public.projects;
DROP POLICY IF EXISTS "admin_all_access_projects" ON public.projects;
CREATE POLICY "admin_all_access_projects" ON public.projects FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
DROP POLICY IF EXISTS "pm_see_assigned_projects" ON public.projects;
CREATE POLICY "pm_see_assigned_projects" ON public.projects FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM') AND projects.pm_id = auth.uid());
DROP POLICY IF EXISTS "pm_update_assigned_projects" ON public.projects;
CREATE POLICY "pm_update_assigned_projects" ON public.projects FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM') AND projects.pm_id = auth.uid())
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM') AND projects.pm_id = auth.uid());
DROP POLICY IF EXISTS "pm_create_projects" ON public.projects;
CREATE POLICY "pm_create_projects" ON public.projects FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM') AND created_by = auth.uid());
DROP POLICY IF EXISTS "admin_delete_projects" ON public.projects;
CREATE POLICY "admin_delete_projects" ON public.projects FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));

-- ===================== SUPPLIERS (project-linked) =====================
DROP POLICY IF EXISTS "Enable all for suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Auth read suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "admin_all_access_suppliers" ON public.suppliers;
CREATE POLICY "admin_all_access_suppliers" ON public.suppliers FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
DROP POLICY IF EXISTS "pm_see_linked_suppliers" ON public.suppliers;
CREATE POLICY "pm_see_linked_suppliers" ON public.suppliers FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM')
    AND (
      EXISTS (SELECT 1 FROM public.supplier_pm_assignments spa WHERE spa.supplier_id = suppliers.id AND spa.pm_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.projects pr WHERE pr.supplier_id = suppliers.id AND pr.pm_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "pm_update_linked_suppliers" ON public.suppliers;
CREATE POLICY "pm_update_linked_suppliers" ON public.suppliers FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM')
    AND (
      EXISTS (SELECT 1 FROM public.supplier_pm_assignments spa WHERE spa.supplier_id = suppliers.id AND spa.pm_id = auth.uid())
      OR EXISTS (SELECT 1 FROM public.projects pr WHERE pr.supplier_id = suppliers.id AND pr.pm_id = auth.uid())
    )
  );

-- ===================== SUPPLIER_PM_ASSIGNMENTS =====================
DROP POLICY IF EXISTS "auth_all_supplier_pm_assignments" ON public.supplier_pm_assignments;
DROP POLICY IF EXISTS "admin_all_access_supplier_pm_assignments" ON public.supplier_pm_assignments;
CREATE POLICY "admin_all_access_supplier_pm_assignments" ON public.supplier_pm_assignments FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
DROP POLICY IF EXISTS "pm_read_own_supplier_assignments" ON public.supplier_pm_assignments;
CREATE POLICY "pm_read_own_supplier_assignments" ON public.supplier_pm_assignments FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM') AND supplier_pm_assignments.pm_id = auth.uid());

-- ===================== PROJECT_STEPS (cascade) =====================
DROP POLICY IF EXISTS "Enable all for steps" ON public.project_steps;
DROP POLICY IF EXISTS "admin_all_access_steps" ON public.project_steps;
CREATE POLICY "admin_all_access_steps" ON public.project_steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
DROP POLICY IF EXISTS "pm_access_own_project_steps" ON public.project_steps;
CREATE POLICY "pm_access_own_project_steps" ON public.project_steps FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p JOIN public.projects pr ON pr.id = project_steps.project_id
                 WHERE p.id = auth.uid() AND upper(p.role) = 'PM' AND pr.pm_id = auth.uid()));

-- ===================== PROJECT_DOCUMENTS (cascade; anon_select_visible_docs left intact) =====================
DROP POLICY IF EXISTS "Enable all for docs" ON public.project_documents;
DROP POLICY IF EXISTS "admin_all_access_docs" ON public.project_documents;
CREATE POLICY "admin_all_access_docs" ON public.project_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
DROP POLICY IF EXISTS "pm_access_own_project_docs" ON public.project_documents;
CREATE POLICY "pm_access_own_project_docs" ON public.project_documents FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p JOIN public.projects pr ON pr.id = project_documents.project_id
                 WHERE p.id = auth.uid() AND upper(p.role) = 'PM' AND pr.pm_id = auth.uid()));

-- ===================== COMPLIANCE_REQUESTS (recreate PM policy case-insensitive) =====================
DROP POLICY IF EXISTS "pm_access_own_compliance_requests" ON public.compliance_requests;
CREATE POLICY "pm_access_own_compliance_requests" ON public.compliance_requests FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM'
                 AND compliance_requests.project_id IN (SELECT id FROM public.projects WHERE pm_id = auth.uid())));

-- ===================== PRODUCTION_UPDATES (cascade) =====================
DROP POLICY IF EXISTS "Enable all for authenticated" ON public.production_updates;
DROP POLICY IF EXISTS "Enable all for production_updates" ON public.production_updates;
DROP POLICY IF EXISTS "admin_all_access_production_updates" ON public.production_updates;
CREATE POLICY "admin_all_access_production_updates" ON public.production_updates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
DROP POLICY IF EXISTS "pm_access_own_production_updates" ON public.production_updates;
CREATE POLICY "pm_access_own_production_updates" ON public.production_updates FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p JOIN public.projects pr ON pr.id = production_updates.project_id
                 WHERE p.id = auth.uid() AND upper(p.role) = 'PM' AND pr.pm_id = auth.uid()));

-- ===================== RFQS (PMs see/manage/create their own) =====================
DROP POLICY IF EXISTS "Enable all for rfqs" ON public.rfqs;
DROP POLICY IF EXISTS "admin_all_access_rfqs" ON public.rfqs;
CREATE POLICY "admin_all_access_rfqs" ON public.rfqs FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
DROP POLICY IF EXISTS "pm_see_own_rfqs" ON public.rfqs;
CREATE POLICY "pm_see_own_rfqs" ON public.rfqs FOR SELECT TO authenticated
  USING (rfqs.created_by = auth.uid());
DROP POLICY IF EXISTS "pm_create_own_rfqs" ON public.rfqs;
CREATE POLICY "pm_create_own_rfqs" ON public.rfqs FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM') AND created_by = auth.uid());
DROP POLICY IF EXISTS "pm_manage_own_rfqs" ON public.rfqs;
CREATE POLICY "pm_manage_own_rfqs" ON public.rfqs FOR UPDATE TO authenticated
  USING (rfqs.created_by = auth.uid());

-- ===================== SUPPLIER_PROPOSALS (project-linked) =====================
DROP POLICY IF EXISTS "Enable read all proposals for authenticated" ON public.supplier_proposals;
DROP POLICY IF EXISTS "Enable update proposals for authenticated" ON public.supplier_proposals;
DROP POLICY IF EXISTS "admin_all_access_supplier_proposals" ON public.supplier_proposals;
CREATE POLICY "admin_all_access_supplier_proposals" ON public.supplier_proposals FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'ADMIN'));
DROP POLICY IF EXISTS "pm_see_linked_supplier_proposals" ON public.supplier_proposals;
CREATE POLICY "pm_see_linked_supplier_proposals" ON public.supplier_proposals FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM')
    AND (
      supplier_proposals.supplier_id IN (SELECT supplier_id FROM public.supplier_pm_assignments WHERE pm_id = auth.uid())
      OR supplier_proposals.supplier_id IN (SELECT supplier_id FROM public.projects WHERE pm_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS "pm_manage_linked_supplier_proposals" ON public.supplier_proposals;
CREATE POLICY "pm_manage_linked_supplier_proposals" ON public.supplier_proposals FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND upper(p.role) = 'PM')
    AND (
      supplier_proposals.supplier_id IN (SELECT supplier_id FROM public.supplier_pm_assignments WHERE pm_id = auth.uid())
      OR supplier_proposals.supplier_id IN (SELECT supplier_id FROM public.projects WHERE pm_id = auth.uid())
    )
  );

NOTIFY pgrst, 'reload schema';
