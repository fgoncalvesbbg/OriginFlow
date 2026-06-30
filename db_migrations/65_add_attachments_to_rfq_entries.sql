-- Migration 65: Add attachments JSONB column to rfq_entries
-- Stores the supplier's uploaded quote documents (supports multiple files per quote).
-- The legacy single-file quote_file_url column is kept for backwards compatibility.
--
-- Structure of each element in the array:
--   {
--     "name": "<original file name>",
--     "url": "<public storage URL>",
--     "type": "<mime type or extension>"
--   }

ALTER TABLE public.rfq_entries
ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.rfq_entries.attachments IS
  'Array of {name, url, type} — supplier-uploaded quote documents (multiple allowed)';

-- Force PostgREST schema reload
NOTIFY pgrst, 'reload schema';
