-- 104: Save attribution for project manuals.
--
-- saveProjectIM now records WHO last saved the row. This powers the concurrent-edit
-- conflict message ("saved by X at T after you loaded it") — without it a collision
-- could only say "someone else". Must be applied BEFORE deploying the code that
-- writes it (the save payload includes the column unconditionally).

ALTER TABLE public.project_ims
  ADD COLUMN IF NOT EXISTS updated_by text;

COMMENT ON COLUMN public.project_ims.updated_by IS
  'Email/id of the user whose save last wrote this row. Used by the concurrent-edit conflict guard.';
