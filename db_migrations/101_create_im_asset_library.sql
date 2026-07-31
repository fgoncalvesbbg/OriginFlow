-- Migration 101: im_asset_folders / im_assets — a real, foldered, searchable
-- asset database backing the IM Template Editor and Project IM Generator's
-- "Asset Library" (previously just a flat, chronological list of whatever was
-- in the `im-assets` bucket's `library/` storage folder — see migration 50).
--
-- Assets still live in the existing public `im-assets` Storage bucket; this
-- table layer adds real metadata (a name, an alt text, a folder) on top of the
-- storage URL so the library can be organized and searched instead of just
-- listed by upload date. `storage_path` is nullable because the seeded ISO
-- pictograms below are inline SVG data URIs with no backing storage object.
--
-- Mirrors the `Auth all` RLS convention used by `im_shares` (migration 84) —
-- these editors already sit behind ProtectedRoute, so there's no separate
-- anon/public policy to add.

CREATE TABLE IF NOT EXISTS im_asset_folders (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT        NOT NULL UNIQUE,
  sort_order INT         NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS im_assets (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id    UUID        REFERENCES im_asset_folders(id) ON DELETE SET NULL,
  name         TEXT        NOT NULL,
  url          TEXT        NOT NULL,
  storage_path TEXT,
  alt_text     TEXT,
  created_by   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_im_assets_folder ON im_assets(folder_id, created_at DESC);

ALTER TABLE im_asset_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE im_assets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_asset_folders' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON im_asset_folders FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='im_assets' AND policyname='Auth all') THEN
    CREATE POLICY "Auth all" ON im_assets FOR ALL TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Seed the three example folders from the request (Generic, Project Related,
-- ISO Symbols), plus the existing 5 ISO 7010/7000 callout pictograms
-- (InlineBlockEditor.tsx's ISO_W001/W012/W021/W017/M002) as ready-to-use inline
-- SVG assets in the ISO Symbols folder — additive to, and independent of, the
-- callout-box feature those constants also back.

INSERT INTO im_asset_folders (name, sort_order) VALUES
  ('Generic', 0),
  ('Project Related', 1),
  ('ISO Symbols', 2)
ON CONFLICT (name) DO NOTHING;

INSERT INTO im_assets (folder_id, name, url, alt_text)
SELECT f.id, v.name, v.url, v.alt_text
FROM im_asset_folders f
JOIN (VALUES
  ('General Warning (ISO 7010 W001)', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBzdHlsZT0iZGlzcGxheTpibG9jazt3aWR0aDoxMDAlO2hlaWdodDoxMDAlOyI+PHBvbHlnb24gcG9pbnRzPSI1MCw2IDk0LDg3IDYsODciIGZpbGw9IiNGRkRBMDAiIHN0cm9rZT0iIzIzMUYyMCIgc3Ryb2tlLXdpZHRoPSI0LjUiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48cmVjdCB4PSI0Ni41IiB5PSIzMCIgd2lkdGg9IjciIGhlaWdodD0iMzEiIHJ4PSIyLjUiIGZpbGw9IiMyMzFGMjAiLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjczIiByPSI1LjUiIGZpbGw9IiMyMzFGMjAiLz48L3N2Zz4=', 'General Warning (ISO 7010 W001)'),
  ('Electrical Hazard (ISO 7010 W012)', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBzdHlsZT0iZGlzcGxheTpibG9jazt3aWR0aDoxMDAlO2hlaWdodDoxMDAlOyI+PHBvbHlnb24gcG9pbnRzPSI1MCw2IDk0LDg3IDYsODciIGZpbGw9IiNGRkRBMDAiIHN0cm9rZT0iIzIzMUYyMCIgc3Ryb2tlLXdpZHRoPSI0LjUiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48cGF0aCBkPSJNNTcsMjQgTDM5LDU1IEw1MSw1NSBMNDQsNzggTDYyLDQ3IEw1MCw0NyBaIiBmaWxsPSIjMjMxRjIwIi8+PC9zdmc+', 'Electrical Hazard (ISO 7010 W012)'),
  ('Risk of Fire (ISO 7010 W021)', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2MDAgNTI1IiBzdHlsZT0iZGlzcGxheTpibG9jazt3aWR0aDoxMDAlO2hlaWdodDoxMDAlOyI+PHBhdGggZD0iTSA1OTcuNiw0OTkuNiAzMTMuOCw4IEMgMzEwLjksMyAzMDUuNiwwIDI5OS45LDAgMjk0LjIsMCAyODguOSwzLjEgMjg2LDggTCAyLjIsNDk5LjYgYyAtMi45LDUgLTIuOSwxMS4xIDAsMTYgMi45LDUgOC4yLDggMTMuOSw4IGggNTY3LjYgYyA1LjcsMCAxMSwtMy4xIDEzLjksLTggMi45LC01IDIuOSwtMTEuMSAwLC0xNiB6IiBmaWxsPSIjMjMxRjIwIi8+PHBvbHlnb24gcG9pbnRzPSI0My44NzUsNDkxLjUgMjk5Ljg3NSw0OC4yIDU1NS44NzUsNDkxLjUiIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDAuOTk1OTE0NTgsMC4xMjUsMi4wMzMyNDM3KSIgZmlsbD0iI0ZGREEwMCIvPjxwYXRoIGQ9Im0gMjU0LjIwNTk5LDQxMi43MDM0OCBjIC0yMy43NjAxOSwtMTAuMzQyMDkgLTMzLjA5NDU1LC0zMC4zOTE4OCAtMzUuNzE3MDYsLTc2LjcxODYzIC0xLjA2MTQxLC0xOC43NSAtMS4xMzQxOCwtMzQuMDkwOTEgLTAuMTYxNjksLTM0LjA5MDkxIDAuOTcyNDksMCA0LjI5NTE5LDEuMzUyNDMgNy4zODM3OSwzLjAwNTM5IDQuOTg4MjQsMi42Njk2NCA1Ljk5Nzk4LDEuMjMwNzkgOS4wMzgwNCwtMTIuODc4NzggMS44ODIzMywtOC43MzYzIDQuMjM0MzYsLTIxLjc1NzE5IDUuMjI2NzMsLTI4LjkzNTMgbCAxLjgwNDMxLC0xMy4wNTExMiA5Ljg4MjQ2LDkuNTc4NDYgOS44ODI0Nyw5LjU3ODQ2IDIuMTI0NzksLTIyLjY3NDY5IGMgMS4xNjg2NCwtMTIuNDcxMDggMS4xNjM1NSwtMjcuMDUxMTkgLTAuMDExMiwtMzIuNDAwMjQgLTIuMDA3NzYsLTkuMTQxMjkgLTEuNzU4MTksLTkuNTIzMzEgNC4xNTQ0NSwtNi4zNTg5NiAzLjQ1OTc5LDEuODUxNjIgNy43MzM0LDYuMDYyNjEgOS40OTY5LDkuMzU3NzUgNS45NDk4NywxMS4xMTc1OSA5LjA1MzY2LDYuMDk4MTIgOS4wNTM2NiwtMTQuNjQxNzggMCwtMTMuMDMwNTcgMS41ODM4MiwtMjIuNzk4OTUgNC4yOTg1LC0yNi41MTE0OSA0LjEyODY2LC01LjY0NjI4IDQuMzgzMDQsLTUuNTQxNzQgNi40Mzc5NywyLjY0NTc3IDEuMTc2NzEsNC42ODgzOCA4LjAzMjEzLDE1LjQyNzc1IDE1LjIzNDI2LDIzLjg2NTI2IDcuMjAyMTIsOC40Mzc1MSAxMy42NDYxOCwxOC45MTgxIDE0LjMyMDEyLDIzLjI5MDE5IGwgMS4yMjUzMyw3Ljk0OTI2IDAuNDU0MDMsLTguMzMzMzMgYyAwLjU3OTgyLC0xMC42NDE5OSA0LjEyMzgyLC0xMC41MzQ0IDEzLjMyODM3LDAuNDA0NiA2LjY2Mzk0LDcuOTE5NjIgMTAuMTM0NTEsMTcuNDg1ODggMTYuMDY5LDQ0LjI5MjM3IDEuOTM0NTEsOC43Mzg0NSAyLjExMzYsOC44MjY1NiA0LjYxODc5LDIuMjcyNzMgMy4zMzgzLC04LjczMzQgNi44NjQyMSwtOC42Mzc3NCAxMS42NTYyMSwwLjMxNjIzIDQuNjczNjksOC43MzI4OCA1LjM5NDM2LDI0LjQ4MjU3IDIuMzA4MDYsNTAuNDQxMzQgLTIuMDc2MjEsMTcuNDYyODIgLTEuODQ0NTIsMTkuMDc1NjcgMi4wNDI3NiwxNC4yMTkzNiA0LjA0ODY5LC01LjA1Nzk3IDQuNTM5MzMsLTQuNTYxNzkgNi40MDQzLDYuNDc2OTEgMi41NTE2NCwxNS4xMDI5NCAtMi43Njg3LDM1LjQyMzY0IC0xMi43MTYzMyw0OC41NjkyMSAtOS45NzkwMywxMy4xODcxMiAtMzQuNTAyNCwyNC42MDU5NCAtNTIuOTI2NzYsMjQuNjQ0MyAtMTcuOTU2NzksMC4wMzczIC0yMC40MjI4NCwtMy43Njg2NiAtNy40MTQ2NywtMTEuNDQzNjYgMTEuOTIyNDYsLTcuMDM0NDMgMjQuMDM5ODUsLTIyLjA2OTg4IDMwLjc3MjE1LC0zOC4xODI1OCA0LjUyODU1LC0xMC44MzgyNyA0LjQ5MTk3LC0xMS4zNTggLTAuNjgzMjQsLTkuNzE1NDIgLTQuODMyMjQsMS41MzM2NyAtNS4zNTA1NSwwLjA2NTggLTQuNDU5MywtMTIuNjI4NDggbCAxLjAwODQyLC0xNC4zNjM4OCAtNy45MTY0MiwxMS4zNjM2MyBjIC0xMC4wMDI2NCwxNC4zNTgzNCAtMTQuMTUwMzQsMTQuNTUxOTcgLTEwLjI2NDY0LDAuNDc5MTUgMy43NTEyNCwtMTMuNTg1ODcgMC43NDc5NywtMzMuMDM4MyAtNy4wOTE3MywtNDUuOTMzNjkgLTMuMjkzMDYsLTUuNDE2NjcgLTYuNDY0ODgsLTkuODQ4NDkgLTcuMDQ4NTMsLTkuODQ4NDkgLTAuNTgzNjQsMCAtMS4wMTU1NCwxMS4yNSAtMC45NTk3OCwyNSAwLjA5OTQsMjQuNTE2MjEgLTMuNjkwMjEsNDEuNjY2NjcgLTkuMjA2ODUsNDEuNjY2NjcgLTEuNTI5NjYsMCAtNC45MDIyNCwtNS4xMTM2NCAtNy40OTQ2MiwtMTEuMzYzNjQgbCAtNC43MTM0MSwtMTEuMzYzNjMgLTAuNDYzMTcsMTAuNjA2MDYgYyAtMC4yNTQ3Miw1LjgzMzMzIC0wLjIyMDUxLDE1LjAzNzg4IDAuMDc2LDIwLjQ1NDU0IDAuMjk2NTUsNS40MTY2NyAtMC44NTE1OSw5Ljg0ODQ5IC0yLjU1MTQ1LDkuODQ4NDkgLTUuMDg2MzEsMCAtMTIuNTUwMDgsLTEyLjg2Njc5IC0xNC41MDIsLTI1IC0yLjAwNTA2LC0xMi40NjM1NSAtNi44NDMxNiwtMTUuMzY2NDMgLTcuNTc1NjgsLTQuNTQ1NDYgLTAuOTgwMiwxNC40Nzk0NiAtMS40NDkxMSwxNS44ODU0OSAtNS4wNDYwMiwxNS4xMzA1MiAtOC4yNDc5OSwtMS43MzEyMSAzLjg1Njk1LDMwLjA4NDkxIDE3LjI0OTcxLDQ1LjMzODM5IDUuMjA4NDksNS45MzIxNSA5LjQ2OTk5LDExLjYyODQyIDkuNDY5OTksMTIuNjU4NDIgMCwzLjMxMjQ5IC0xNi4zNzMsMS43NjMyOCAtMjYuMDk3MDQsLTIuNDY5MyB6IE0gMTg1LDQ1NSBsIDAsLTI1IDIzMCwwIDAsMjUgeiIgZmlsbD0iIzIzMUYyMCIvPjwvc3ZnPg==', 'Risk of Fire (ISO 7010 W021)'),
  ('Hot Surface (ISO 7010 W017)', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2MDAgNTI1IiBzdHlsZT0iZGlzcGxheTpibG9jazt3aWR0aDoxMDAlO2hlaWdodDoxMDAlOyI+PHBhdGggZD0iTTU5Ny42LDQ5OS42LDMxMy44LDhjLTIuOS01LTguMi04LTEzLjktOHMtMTEsMy4xLTEzLjksOGwtMjgzLjgsNDkxLjZjLTIuOSw1LTIuOSwxMS4xLDAsMTYsMi45LDUsOC4yLDgsMTMuOSw4aDU2Ny42YzUuNywwLDExLTMuMSwxMy45LTgsMi45LTUsMi45LTExLjEsMC0xNnoiIGZpbGw9IiMyMzFGMjAiLz48cG9seWdvbiBwb2ludHM9IjQzLjg3NSw0OTEuNSwyOTkuODgsNDguMiw1NTUuODgsNDkxLjUiIHRyYW5zZm9ybT0ibWF0cml4KDEsMCwwLDAuOTk1OTE0NTgsMC4xMjUsMi4wMzMyNDM3KSIgZmlsbD0iI0ZGREEwMCIvPjxyZWN0IHg9IjE3NSIgeT0iNDM3IiB3aWR0aD0iMjUwIiBoZWlnaHQ9IjI1IiBmaWxsPSIjMjMxRjIwIi8+PHBhdGggZD0iTTI0Mi42OCw0MTVjNTYuODYtODEuMy02MC42OC0xMDQuMTYtMi42OC0xODUiIHN0cm9rZT0iIzIzMUYyMCIgc3Ryb2tlLXdpZHRoPSIxNiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Im0zMDMuNzgsNDE0LjUxYzU2Ljg2LTgxLjMtNjAuNTYxLTEwMy40My0yLjU2MS0xODQuMjciIHN0cm9rZT0iIzIzMUYyMCIgc3Ryb2tlLXdpZHRoPSIxNiIgZmlsbD0ibm9uZSIvPjxwYXRoIGQ9Ik0zNjUsNDE1YzU2Ljg2LTgxLjMtNTkuMjMtMTA0LjY1LTEuMjItMTg1LjQ5IiBzdHJva2U9IiMyMzFGMjAiIHN0cm9rZS13aWR0aD0iMTYiIGZpbGw9Im5vbmUiLz48L3N2Zz4=', 'Hot Surface (ISO 7010 W017)'),
  ('Information (ISO 7000 M002)', 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIiBzdHlsZT0iZGlzcGxheTpibG9jazt3aWR0aDoxMDAlO2hlaWdodDoxMDAlOyI+PGNpcmNsZSBjeD0iNTAiIGN5PSI1MCIgcj0iNDYiIGZpbGw9IiMwMDY2QjIiLz48Y2lyY2xlIGN4PSI1MCIgY3k9IjI2IiByPSI3IiBmaWxsPSJ3aGl0ZSIvPjxyZWN0IHg9IjQzIiB5PSI0MCIgd2lkdGg9IjE0IiBoZWlnaHQ9IjM2IiByeD0iNCIgZmlsbD0id2hpdGUiLz48L3N2Zz4=', 'Information (ISO 7000 M002)')
) AS v(name, url, alt_text) ON true
WHERE f.name = 'ISO Symbols'
  AND NOT EXISTS (
    SELECT 1 FROM im_assets a WHERE a.folder_id = f.id AND a.name = v.name
  );

NOTIFY pgrst, 'reload schema';
