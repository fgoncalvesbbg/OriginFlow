-- Migration 80: Fix advisor ERROR `security_definer_view` on im_block_section_usage.
--
-- The view ran with its owner's (elevated) rights, bypassing RLS on the underlying
-- im_blocks / im_sections / im_templates tables. Switch it to security_invoker so it
-- runs with the querying user's permissions and respects their RLS. The view is a
-- read-only internal IM join; all three underlying tables grant authenticated SELECT,
-- so app reads are unaffected.

ALTER VIEW public.im_block_section_usage SET (security_invoker = true);
