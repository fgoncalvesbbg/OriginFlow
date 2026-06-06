-- Migration 54: Create im-published Supabase Storage bucket + extend publish snapshots
--
-- The resolver produces a structured, render-agnostic ResolvedManual (JSON). On Generate we
-- now write one JSON file per language to the public `im-published` bucket plus a manifest,
-- so an external web/PDF render service can consume the IM by a stable URL. Mirrors the
-- `im-assets` bucket policy (migration 50): public read, authenticated write.
--
-- Idempotent: safe to re-run.

-- 1. Public bucket for published structured IM JSON
INSERT INTO storage.buckets (id, name, public)
VALUES ('im-published', 'im-published', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (so the render service / web platform can fetch by URL without tokens)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-published public read'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-published public read" ON storage.objects
        FOR SELECT USING (bucket_id = 'im-published');
    $p$;
  END IF;
END $$;

-- Authenticated upload
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-published auth insert'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-published auth insert" ON storage.objects
        FOR INSERT WITH CHECK (bucket_id = 'im-published' AND auth.role() = 'authenticated');
    $p$;
  END IF;
END $$;

-- Authenticated update (deterministic paths are re-uploaded with upsert on every Generate)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-published auth update'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-published auth update" ON storage.objects
        FOR UPDATE USING (bucket_id = 'im-published' AND auth.role() = 'authenticated');
    $p$;
  END IF;
END $$;

-- Authenticated delete
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-published auth delete'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-published auth delete" ON storage.objects
        FOR DELETE USING (bucket_id = 'im-published' AND auth.role() = 'authenticated');
    $p$;
  END IF;
END $$;

-- 2. Extend im_publish_snapshots (created in migration 48) to track the hosted file
--    and the template discriminator that project_ims now carries.
ALTER TABLE public.im_publish_snapshots
  ADD COLUMN IF NOT EXISTS storage_path  text;

ALTER TABLE public.im_publish_snapshots
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'im';
