-- Migration 38: Fix PM RLS policy for compliance_requests INSERT operations
-- Issue: PMs cannot INSERT compliance requests because the RLS policy lacks WITH CHECK clause
-- Solution: Add WITH CHECK clause to allow PMs to create requests for their projects

-- Drop the incomplete policy
DROP POLICY IF EXISTS "pm_access_own_compliance_requests" ON public.compliance_requests;

-- Recreate with both USING and WITH CHECK clauses
-- USING: Controls visibility for SELECT and DELETE
-- WITH CHECK: Controls what rows can be inserted/updated
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
