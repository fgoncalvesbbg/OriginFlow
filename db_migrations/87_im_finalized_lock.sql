-- 87: Safety lock for finalized IM templates.
--
-- A template marked FINAL (im_templates.is_finalized) must be explicitly
-- unlocked ("pre-released") before any change is possible. The editor enforces
-- this in the UI; these triggers enforce it server-side so no code path —
-- imports, scripts, a stale tab — can modify a released template by accident.
--
-- Rules:
--   im_sections: INSERT/UPDATE/DELETE blocked while the owning template is
--     finalized (both the old and new template on a re-parenting UPDATE).
--   im_templates: while finalized, the ONLY permitted UPDATE is one that
--     unlocks it (sets is_finalized = false); DELETE is blocked until unlocked.
--     Marking a template final (false -> true) is always allowed.

create or replace function public.im_sections_finalized_guard()
returns trigger
language plpgsql
as $$
declare
  v_old_tid uuid := case when tg_op <> 'INSERT' then old.template_id end;
  v_new_tid uuid := case when tg_op <> 'DELETE' then new.template_id end;
begin
  if exists (
    select 1 from public.im_templates t
    where t.id in (v_old_tid, v_new_tid) and t.is_finalized
  ) then
    raise exception 'IM template is finalized — unlock (pre-release) it before changing its sections';
  end if;
  return coalesce(new, old);
end;
$$;

drop trigger if exists im_sections_finalized_lock on public.im_sections;
create trigger im_sections_finalized_lock
before insert or update or delete on public.im_sections
for each row execute function public.im_sections_finalized_guard();

create or replace function public.im_templates_finalized_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_finalized then
      raise exception 'IM template is finalized — unlock (pre-release) it before deleting';
    end if;
    return old;
  end if;
  -- UPDATE: anything goes while unlocked; while locked, only the unlock itself.
  if old.is_finalized and new.is_finalized then
    raise exception 'IM template is finalized — unlock (pre-release) it before editing';
  end if;
  return new;
end;
$$;

drop trigger if exists im_templates_finalized_lock on public.im_templates;
create trigger im_templates_finalized_lock
before update or delete on public.im_templates
for each row execute function public.im_templates_finalized_guard();
