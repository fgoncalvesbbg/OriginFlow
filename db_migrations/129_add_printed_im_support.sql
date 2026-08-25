-- 129: Printed IM — a governed, per-project subset-of-languages print run of the
-- Instruction Manual (project_ims.template_type = 'im'), sitting alongside the Digital
-- IM and the Warning Leaflet. It is NOT a new document/template: it shares the exact
-- same authored content as the Digital IM (same project_ims row), just a smaller set of
-- languages, because it physically ships with the product together with the Warning
-- Leaflet while the Digital IM stays web-only.
--
-- The printed LANGUAGE SET itself gets no new column — it follows the same convention
-- the Digital IM's own language set already uses (placeholder_data['__required_languages'],
-- see getProjectRequiredLanguages): stored as placeholder_data['__printed_languages'] /
-- ['__printed_language_order'], defaulting to all of the Digital IM's required languages
-- until narrowed. Only the FINAL/lock state needs real columns, because — like the
-- Digital IM's own is_finalized (migration 98/102) — it needs a DB-enforced guard.
--
-- printed_render_id points at the specific im_print_renders row (the actual rendered
-- PDF) that was signed off as "the one that ships", so Printed-IM-final always names a
-- concrete immutable artifact rather than just flipping a flag.

ALTER TABLE public.project_ims
  ADD COLUMN IF NOT EXISTS printed_is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS printed_finalized_at timestamptz,
  ADD COLUMN IF NOT EXISTS printed_finalized_by text,
  ADD COLUMN IF NOT EXISTS printed_render_id uuid REFERENCES public.im_print_renders(id);

COMMENT ON COLUMN public.project_ims.printed_is_finalized IS
  'The Printed IM (a language subset of this same manual) is signed off and locked. Independent of is_finalized (the Digital IM''s own sign-off), but a printed sign-off requires the Digital IM to already be final — see project_ims_finalized_guard.';
COMMENT ON COLUMN public.project_ims.printed_render_id IS
  'im_print_renders.id of the exact PDF that was signed off as the shipped Printed IM. Required when printed_is_finalized is true.';

-- Extend the existing FINAL guard (migration 102) with the Printed IM's rules, in the
-- same function/trigger rather than a second one:
--   - DELETE is blocked while printed_is_finalized, mirroring the is_finalized rule.
--   - Turning printed_is_finalized on requires the Digital IM to already be final
--     (same content — it must be locked first) and a render to point at. Because the
--     printed language subset lives in placeholder_data['__printed_languages'], it is
--     already frozen the moment is_finalized is true (the existing content-freeze rule
--     below) — no separate freeze is needed for it.
--   - While printed_is_finalized is true, printed_render_id itself is frozen (which
--     render is "the final one" can't be swapped without unlocking first).
create or replace function public.project_ims_finalized_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_finalized then
      raise exception 'Project manual is marked FINAL — unlock it before deleting';
    end if;
    if old.printed_is_finalized then
      raise exception 'Printed IM is marked FINAL — unlock it before deleting';
    end if;
    return old;
  end if;

  -- UPDATE: anything goes while unlocked; while locked, content columns are frozen.
  if old.is_finalized and new.is_finalized then
    if new.placeholder_data  is distinct from old.placeholder_data
      or new.sku_content       is distinct from old.sku_content
      or new.section_additions is distinct from old.section_additions
      or new.extra_sections    is distinct from old.extra_sections
      or new.section_overrides is distinct from old.section_overrides
      or new.section_skus      is distinct from old.section_skus
      or new.block_overrides   is distinct from old.block_overrides
      or new.template_id       is distinct from old.template_id
      or new.bound_sku_ids     is distinct from old.bound_sku_ids
    then
      raise exception 'Project manual is marked FINAL — unlock it before editing its content';
    end if;
  end if;

  if (not old.printed_is_finalized) and new.printed_is_finalized then
    if not new.is_finalized then
      raise exception 'The Digital IM must be marked FINAL before the Printed IM can be finalized';
    end if;
    if new.printed_render_id is null then
      raise exception 'Finalizing the Printed IM requires a print render to sign off against';
    end if;
  end if;

  if old.printed_is_finalized and new.printed_is_finalized then
    if new.printed_render_id is distinct from old.printed_render_id then
      raise exception 'Printed IM is marked FINAL — unlock it before changing which render is final';
    end if;
  end if;

  return new;
end;
$$;

-- Trigger already exists from migration 102 and points at this function — no need to
-- recreate it, replacing the function body is enough. Re-stated here for clarity only.
drop trigger if exists project_ims_finalized_lock on public.project_ims;
create trigger project_ims_finalized_lock
before update or delete on public.project_ims
for each row execute function public.project_ims_finalized_guard();
