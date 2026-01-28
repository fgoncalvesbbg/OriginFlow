-- Migration 38: Fix admin & PM RLS policies for compliance_requests INSERT operations
-- Issue: Both ADMIN and PM policies lack WITH CHECK clause, blocking INSERT operations
-- Solution: Add WITH CHECK clause to allow admins and PMs to create compliance requests

-- Drop the incomplete admin policy
DROP POLICY IF EXISTS "admin_all_access_compliance_requests" ON public.compliance_requests;

-- Recreate admin policy with both USING and WITH CHECK clauses
CREATE POLICY "admin_all_access_compliance_requests" ON public.compliance_requests
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles prof
    WHERE prof.id = auth.uid()
    AND prof.role = 'ADMIN'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles prof
    WHERE prof.id = auth.uid()
    AND prof.role = 'ADMIN'
  )
);

-- Drop the incomplete PM policy
DROP POLICY IF EXISTS "pm_access_own_compliance_requests" ON public.compliance_requests;

-- Recreate PM policy with both USING and WITH CHECK clauses
CREATE POLICY "pm_access_own_compliance_requests" ON public.compliance_requests
FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles prof
    WHERE prof.id = auth.uid()
    AND prof.role = 'PM'
    AND compliance_requests.project_id IN (
      SELECT id FROM public.projects WHERE pm_id = auth.uid()
    )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles prof
    WHERE prof.id = auth.uid()
    AND prof.role = 'PM'
    AND compliance_requests.project_id IN (
      SELECT id FROM public.projects WHERE pm_id = auth.uid()
    )
  )
);

-- Notify PostgREST to reload schema
NOTIFY pgrst, 'reload schema';
