-- Migration 50: Create im-assets Supabase Storage bucket for IM images
-- Public bucket — images are served directly without auth tokens.
-- Writes are restricted to authenticated users.

INSERT INTO storage.buckets (id, name, public)
VALUES ('im-assets', 'im-assets', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (so <img src="..."> works without tokens)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-assets public read'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-assets public read" ON storage.objects
        FOR SELECT USING (bucket_id = 'im-assets');
    $p$;
  END IF;
END $$;

-- Authenticated upload
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-assets auth insert'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-assets auth insert" ON storage.objects
        FOR INSERT WITH CHECK (bucket_id = 'im-assets' AND auth.role() = 'authenticated');
    $p$;
  END IF;
END $$;

-- Authenticated update / delete
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-assets auth update'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-assets auth update" ON storage.objects
        FOR UPDATE USING (bucket_id = 'im-assets' AND auth.role() = 'authenticated');
    $p$;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-assets auth delete'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-assets auth delete" ON storage.objects
        FOR DELETE USING (bucket_id = 'im-assets' AND auth.role() = 'authenticated');
    $p$;
  END IF;
END $$;
