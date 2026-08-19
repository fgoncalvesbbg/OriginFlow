-- 103: Remove open DELETE on im_print_renders.
--
-- im_print_renders is the print-artifact changelog (which PDF was generated from which
-- manual version, by whom, with what change note) — it doubles as the compliance record
-- of what was sent to print. The blanket "Auth delete" policy from migration 68 let ANY
-- authenticated user erase any row of that history.
--
-- Nothing in the application deletes render rows (the only client access is a SELECT in
-- im-print-export.service.ts; inserts happen server-side in render-print-merge via the
-- service role, which bypasses RLS), so the policy can simply be dropped. History rows
-- are append-only from the product's point of view.

DROP POLICY IF EXISTS "Auth delete" ON public.im_print_renders;
