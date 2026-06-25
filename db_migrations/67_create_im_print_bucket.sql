-- Migration 67: Create im-print Supabase Storage bucket
--
-- The PDF exporter renders a combined PDF (A4/A5, vector/selectable text, clickable TOC, page
-- numbers) from the already-published ResolvedManual JSON and writes it here. Rendering happens in
-- the render-print-pdf Netlify function, which uploads with the service-role key, so write is
-- allowed for both authenticated users and the service role. Mirrors the `im-published` bucket
-- policy (migration 54): public read.
--
-- Idempotent: safe to re-run.

-- 1. Public bucket for rendered print PDFs
INSERT INTO storage.buckets (id, name, public)
VALUES ('im-print', 'im-print', true)
ON CONFLICT (id) DO NOTHING;

-- Public read (so the download link works without tokens)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-print public read'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-print public read" ON storage.objects
        FOR SELECT USING (bucket_id = 'im-print');
    $p$;
  END IF;
END $$;

-- Authenticated upload (the render service uses the service role, which bypasses RLS)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-print auth insert'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-print auth insert" ON storage.objects
        FOR INSERT WITH CHECK (bucket_id = 'im-print' AND auth.role() = 'authenticated');
    $p$;
  END IF;
END $$;

-- Authenticated update (deterministic paths are re-uploaded with upsert on every render)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-print auth update'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-print auth update" ON storage.objects
        FOR UPDATE USING (bucket_id = 'im-print' AND auth.role() = 'authenticated');
    $p$;
  END IF;
END $$;

-- Authenticated delete
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
    AND policyname = 'im-print auth delete'
  ) THEN
    EXECUTE $p$
      CREATE POLICY "im-print auth delete" ON storage.objects
        FOR DELETE USING (bucket_id = 'im-print' AND auth.role() = 'authenticated');
    $p$;
  END IF;
END $$;
