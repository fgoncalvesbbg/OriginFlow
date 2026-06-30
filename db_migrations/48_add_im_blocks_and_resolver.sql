-- Migration 48: Add im_blocks table, block_refs column, publish snapshots, and usage view
-- Run this in the Supabase SQL editor to enable the block-based IM resolver architecture.
-- All changes are additive and non-breaking; existing im_sections rows get block_refs = '[]'.

-- 1. Reusable approved content blocks
CREATE TABLE IF NOT EXISTS public.im_blocks (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug                    text NOT NULL UNIQUE,
  title                   text NOT NULL,
  block_type              text NOT NULL DEFAULT 'content', -- content | warning | caution | electric | info | legacy_html
  source_language         text NOT NULL DEFAULT 'en',
  content                 jsonb NOT NULL DEFAULT '{}',     -- { 'en': '<p>..</p>', 'de': '..' }
  placeholders            text[] NOT NULL DEFAULT '{}',
  applicable_categories   text[] NOT NULL DEFAULT '{}',
  requires_feature        text,
  requires_feature_absent text,
  regulation_refs         text[] NOT NULL DEFAULT '{}',
  approval_status         text NOT NULL DEFAULT 'draft',  -- draft | approved
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  last_updated_by         text
);

CREATE INDEX IF NOT EXISTS im_blocks_slug_idx       ON public.im_blocks (slug);
CREATE INDEX IF NOT EXISTS im_blocks_categories_gin ON public.im_blocks USING gin (applicable_categories);

-- 2. Ordered block reference array on im_sections
--    Existing rows get '[]' (the resolver's legacy fallback reads content[] for them)
ALTER TABLE public.im_sections ADD COLUMN IF NOT EXISTS block_refs jsonb NOT NULL DEFAULT '[]';

-- 3. Published resolved-manual snapshots (for customer platform + supplier PDFs)
CREATE TABLE IF NOT EXISTS public.im_publish_snapshots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  language      text NOT NULL,
  resolved      jsonb NOT NULL,
  content_hash  text NOT NULL,
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  text
);

CREATE INDEX IF NOT EXISTS im_snap_project_idx ON public.im_publish_snapshots (project_id, language, published_at DESC);

-- 4. Block usage view — shows blast radius when editing a shared block
CREATE OR REPLACE VIEW public.im_block_section_usage AS
SELECT
  b.id          AS block_id,
  b.slug,
  s.id          AS section_id,
  s.template_id,
  t.category_id
FROM public.im_blocks b
JOIN public.im_sections s
  ON s.block_refs @> jsonb_build_array(jsonb_build_object('block_id', b.id::text))
JOIN public.im_templates t ON t.id = s.template_id;

-- 5. RLS — match the existing im_* pattern (authenticated = full access)
ALTER TABLE public.im_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.im_publish_snapshots ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'im_blocks' AND policyname = 'Enable all for im blocks'
  ) THEN
    EXECUTE 'CREATE POLICY "Enable all for im blocks" ON public.im_blocks
             FOR ALL USING (auth.role() = ''authenticated'')';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'im_publish_snapshots' AND policyname = 'Enable all for im snapshots'
  ) THEN
    EXECUTE 'CREATE POLICY "Enable all for im snapshots" ON public.im_publish_snapshots
             FOR ALL USING (auth.role() = ''authenticated'')';
  END IF;
END $$;
