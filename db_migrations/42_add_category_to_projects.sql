-- Migration 42: Add category_id to projects table
ALTER TABLE projects ADD COLUMN IF NOT EXISTS category_id TEXT;

-- Allow authenticated users to read all suppliers (needed for PM dropdowns)
-- Run only if not already present:
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'suppliers' AND policyname = 'Auth read suppliers'
  ) THEN
    EXECUTE 'CREATE POLICY "Auth read suppliers" ON suppliers FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;

-- Allow authenticated users to read all profiles (needed for PM assignment dropdown)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'profiles' AND policyname = 'Auth read all profiles'
  ) THEN
    EXECUTE 'CREATE POLICY "Auth read all profiles" ON profiles FOR SELECT TO authenticated USING (true)';
  END IF;
END $$;
