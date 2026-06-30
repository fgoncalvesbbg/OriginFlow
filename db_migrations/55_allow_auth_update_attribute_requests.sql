-- Migration 55: Allow authenticated PMs to update attribute requests
-- The table previously only had an UPDATE policy for the anon role
-- (supplier submit-by-token). PMs editing attribute values from the
-- project Attributes tab use the authenticated client, which had no
-- UPDATE policy, so RLS blocked the update (0 rows -> PGRST116).

CREATE POLICY "Auth update" ON project_attribute_requests
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
