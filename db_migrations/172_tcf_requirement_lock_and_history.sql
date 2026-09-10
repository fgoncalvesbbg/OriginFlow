-- 172: TCF requirements — a category can be locked FINAL, and every change is on the record.
--
-- WHAT WAS BROKEN. `categories_l3.is_finalized` has existed since the category tree was
-- built, the Admin panel offers a "Mark Final" toggle whose tooltip reads "Finalized
-- (Requirements Locked)", and the Compliance Library paints a FINALIZED badge on the row.
-- None of it locked anything. A finalized category's TCF requirements could be added to,
-- edited and deleted by any authenticated user, from the library, from the regulation
-- importer, or straight through the API — and nothing anywhere recorded that it happened.
-- The flag was a sticker, not a control.
--
-- WHAT THIS MIGRATION MAKES TRUE:
--
--   1. FINAL means frozen.       While `categories_l3.is_finalized`, no row of
--                                `compliance_requirements` belonging to that category can be
--                                inserted, updated or deleted. Enforced by a trigger, not by
--                                the UI, because the library is not the only writer — the
--                                regulation importer writes requirements too, and so does
--                                anyone holding a staff JWT.
--
--   2. Only an ADMIN can release it, and only WITH A REASON. Unlocking is not a toggle: it
--                                goes through `release_compliance_category(category, reason)`,
--                                which checks the role and refuses a reason under 10
--                                characters. A direct `update ... set is_finalized = false`
--                                is refused by the same guard, so the reason cannot be
--                                skipped by going around the app.
--
--   3. There is a history.       Every requirement create/update/delete, every lock and every
--                                release lands in `compliance_requirement_history` — written
--                                by trigger, so it is complete by construction rather than by
--                                every caller remembering to log. The table has no write
--                                grant and no write policy: nothing outside these triggers
--                                can append to it, amend it, or delete from it.
--
-- WHAT IS DELIBERATELY *NOT* COVERED:
--
--   Global requirements (`category_id is null`) are NOT frozen by any category's lock. They
--   apply to every category, so honouring one category's lock would freeze the global set for
--   all ~130 of them, and honouring none of them is the only other consistent answer. Their
--   changes ARE logged (with a null category_id), and the library already renders them
--   read-only inside a category view — "Edit in Global" — so no per-category screen offers
--   the edit. If the global set itself needs a lock later, it wants its own decision, not an
--   inference from this one.
--
--   `compliance_sections` is not frozen either. A section group is a label offered to every
--   category; renaming the drawer does not change what is in it.
--
-- ROLE CHECKS follow the migration-81/110 pattern: `profiles.role`, case-insensitive, and
-- `auth.uid() IS NULL` (service role, SQL console) is always allowed — those contexts bypass
-- RLS anyway and must not be bricked by a trigger. Note that a Super Admin (migration 154) is
-- a FLAG on top of role='ADMIN', so the plain role check already admits them.

-- ===========================================================================
-- 1. Who did it
-- ===========================================================================
-- One helper so every history row names the actor the same way, resolved SERVER-side. The
-- client is never asked for it: a compliance record whose author is a request parameter is a
-- compliance record anyone can sign with someone else's name.

create or replace function public.compliance_actor()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(p.name), '') from public.profiles p where p.id = auth.uid()),
    (select nullif(btrim(p.email), '') from public.profiles p where p.id = auth.uid()),
    auth.uid()::text,
    'system'
  );
$$;

comment on function public.compliance_actor() is
  'Display name of the caller for compliance history rows. Resolved server-side from profiles; falls back to the uid, then to ''system'' for service-role/SQL contexts.';

/**
 * Whether the caller may release a FINAL category. A UI hint only — the guard below is the
 * real check. Mirrors that check exactly so the button and the database cannot disagree.
 */
create or replace function public.is_compliance_release_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and upper(p.role) = 'ADMIN'
  );
$$;

comment on function public.is_compliance_release_admin() is
  'UI hint: true when the caller may release a FINAL category. Authoritative check lives in categories_l3_final_guard().';

-- ===========================================================================
-- 2. Who signed it off
-- ===========================================================================
-- `finalized_at` already exists; `finalized_by` is the missing half, exactly as migration 102
-- added it to project_ims. Both are stamped by the trigger below rather than by the caller.

alter table public.categories_l3
  add column if not exists finalized_by text;

comment on column public.categories_l3.finalized_by is
  'Who locked this category''s TCF requirements as FINAL. Stamped by categories_l3_final_guard(); cleared on release. Never written by the client.';

comment on column public.categories_l3.is_finalized is
  'FINAL: this category''s TCF requirement set is frozen. Enforced by compliance_requirements_lock_guard(). Clear it only through release_compliance_category(), which requires an ADMIN and a written reason.';

-- ===========================================================================
-- 3. The history
-- ===========================================================================

create table if not exists public.compliance_requirement_history (
  history_id     bigint generated always as identity primary key,

  -- No foreign keys, on purpose. A category or a requirement can be deleted; the record of
  -- what it required, and of who released the lock to allow that, must outlive it. That is
  -- the whole point of a compliance history, and a cascade would quietly empty it.
  category_id    uuid,
  requirement_id uuid,

  action         text not null check (action in ('create', 'update', 'delete', 'lock', 'release')),

  -- Snapshot of the requirement's identity at the time, so a deleted row still reads as a
  -- name in the history view instead of a uuid.
  title          text,
  section        text,

  -- Mandatory prose for 'release' (enforced in the guard), optional note for 'lock',
  -- always null for the three requirement actions — those are explained by the diff.
  reason         text,

  before_json    jsonb,
  after_json     jsonb,
  /** Column names that differ between before_json and after_json. Null unless action='update'. */
  changed_fields text[],

  changed_at     timestamptz not null default now(),
  changed_by     text
);

comment on table public.compliance_requirement_history is
  'Append-only audit of the TCF requirements library: requirement creates/updates/deletes plus category lock/release events. Written ONLY by triggers in migration 172 — no write grant, no write policy, no foreign keys (records outlive what they describe).';

create index if not exists compliance_requirement_history_category_idx
  on public.compliance_requirement_history (category_id, changed_at desc);

create index if not exists compliance_requirement_history_requirement_idx
  on public.compliance_requirement_history (requirement_id, changed_at desc);

-- ===========================================================================
-- 4. FINAL means frozen
-- ===========================================================================

create or replace function public.compliance_requirements_lock_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_new_cat uuid;
  v_old_cat uuid;
  v_name    text;
begin
  -- Service role / SQL console: no JWT, already outside RLS. Consistent with migration 110.
  if auth.uid() is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  -- `NEW` and `OLD` are only bound for the operations that have them — reading the other one
  -- raises "record not assigned", so each is read inside its own branch and never in a
  -- coalesce across both.
  if tg_op <> 'DELETE' then v_new_cat := new.category_id; end if;
  if tg_op <> 'INSERT' then v_old_cat := old.category_id; end if;

  -- Both sides are checked, so moving a requirement INTO or OUT OF a locked category is
  -- refused too. A single-sided check would let a re-parent edit a frozen set.
  select c.name into v_name
  from public.categories_l3 c
  where c.is_finalized
    and c.id in (v_new_cat, v_old_cat)
  limit 1;

  if v_name is not null then
    raise exception
      'The TCF requirements for "%" are marked FINAL. An administrator must release the category — stating why — before anything here can change.', v_name
      using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists compliance_requirements_lock on public.compliance_requirements;
create trigger compliance_requirements_lock
before insert or update or delete on public.compliance_requirements
for each row execute function public.compliance_requirements_lock_guard();

-- ===========================================================================
-- 5. Every requirement change on the record
-- ===========================================================================

create or replace function public.compliance_requirements_history_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before  jsonb;
  v_after   jsonb;
  v_changed text[];
  v_action  text := lower(tg_op);
  v_cat     uuid;
  v_req     uuid;
  v_title   text;
  v_section text;
begin
  -- Same rule as the guard: read each record only in the branch where it is bound.
  if tg_op <> 'INSERT' then
    v_before := to_jsonb(old);
    v_cat := old.category_id; v_req := old.id; v_title := old.title; v_section := old.section;
  end if;
  if tg_op <> 'DELETE' then
    v_after := to_jsonb(new);
    v_cat := new.category_id; v_req := new.id; v_title := new.title; v_section := new.section;
  end if;

  if tg_op = 'UPDATE' then
    select array_agg(k order by k) into v_changed
    from (
      select key as k from jsonb_each(v_after) where v_before -> key is distinct from value
      union
      select key      from jsonb_each(v_before) where v_after  -> key is distinct from value
    ) d
    where k <> 'id';

    -- An upsert that rewrites a row with identical values is not a change and must not
    -- appear as one, or the history fills with noise and stops being read.
    if v_changed is null then
      return null;
    end if;
  end if;

  insert into public.compliance_requirement_history (
    category_id, requirement_id, action, title, section, before_json, after_json,
    changed_fields, changed_by
  ) values (
    v_cat,
    v_req,
    case v_action when 'insert' then 'create' else v_action end,
    v_title,
    v_section,
    v_before,
    v_after,
    v_changed,
    public.compliance_actor()
  );

  return null;
end;
$$;

drop trigger if exists compliance_requirements_history on public.compliance_requirements;
create trigger compliance_requirements_history
after insert or update or delete on public.compliance_requirements
for each row execute function public.compliance_requirements_history_log();

-- ===========================================================================
-- 6. Locking, and the gate on unlocking
-- ===========================================================================
--
-- The reason travels as a transaction-local GUC rather than as a column, because it belongs
-- to the EVENT and not to the row: a category released three times has three reasons, and
-- only the history can hold all three. `release_compliance_category()` sets it; the guard
-- refuses the unlock without it.
--
-- The GUC is not the authorization — the role check below is, and it stands whether or not
-- the GUC is present. The GUC only guarantees that an authorised unlock is an EXPLAINED one.

create or replace function public.categories_l3_final_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service boolean := auth.uid() is null;
  v_reason  text    := nullif(btrim(coalesce(current_setting('app.compliance_release_reason', true), '')), '');
begin
  if tg_op = 'DELETE' then
    if old.is_finalized and not v_service then
      raise exception
        'The TCF requirements for "%" are marked FINAL — release the category before deleting it.', old.name
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  -- LOCK (false -> true): open to any authenticated user, the way signing off a manual is
  -- (migration 110). Stamped here so the client cannot claim a different author or date.
  if coalesce(new.is_finalized, false) and not coalesce(old.is_finalized, false) then
    new.finalized_at := coalesce(new.finalized_at, now());
    new.finalized_by := public.compliance_actor();
  end if;

  -- RELEASE (true -> false): ADMIN only, and never silently.
  if coalesce(old.is_finalized, false) and not coalesce(new.is_finalized, false) then
    if not v_service then
      if not public.is_compliance_release_admin() then
        raise exception
          'Only an administrator can release a FINAL category.'
          using errcode = 'insufficient_privilege';
      end if;
      if v_reason is null or length(v_reason) < 10 then
        raise exception
          'Releasing a FINAL category requires a written reason of at least 10 characters. Use release_compliance_category(category_id, reason).'
          using errcode = 'check_violation';
      end if;
    end if;
    new.finalized_at := null;
    new.finalized_by := null;
  end if;

  return new;
end;
$$;

drop trigger if exists categories_l3_final_lock on public.categories_l3;
create trigger categories_l3_final_lock
before update or delete on public.categories_l3
for each row execute function public.categories_l3_final_guard();

/**
 * Logs the lock/release itself. AFTER, so it only records transitions the guard allowed,
 * and it reads the same GUCs the guard did — which is why a lock note and a release reason
 * both reach the history without either being a column on the category.
 */
create or replace function public.categories_l3_final_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_locked_now  boolean := coalesce(new.is_finalized, false);
  v_locked_was  boolean := coalesce(old.is_finalized, false);
begin
  if v_locked_now = v_locked_was then
    return null;
  end if;

  insert into public.compliance_requirement_history (
    category_id, action, title, reason, before_json, after_json, changed_by
  ) values (
    new.id,
    case when v_locked_now then 'lock' else 'release' end,
    new.name,
    nullif(btrim(coalesce(current_setting(
      case when v_locked_now then 'app.compliance_lock_note' else 'app.compliance_release_reason' end,
      true), '')), ''),
    jsonb_build_object('is_finalized', v_locked_was, 'finalized_at', old.finalized_at, 'finalized_by', old.finalized_by),
    jsonb_build_object('is_finalized', v_locked_now, 'finalized_at', new.finalized_at, 'finalized_by', new.finalized_by),
    public.compliance_actor()
  );

  return null;
end;
$$;

drop trigger if exists categories_l3_final_history on public.categories_l3;
create trigger categories_l3_final_history
after update on public.categories_l3
for each row execute function public.categories_l3_final_log();

-- ===========================================================================
-- 7. The two doors
-- ===========================================================================
--
-- SECURITY INVOKER, not definer: these are conveniences that carry the note/reason into the
-- transaction, and every rule they rely on is enforced by the triggers above. Running them as
-- the owner would move the role check out of the guard and into the function, which is the
-- one place it must not live — the guard has to hold for a direct table update too.

create or replace function public.lock_compliance_category(
  p_category_id uuid,
  p_note        text default null
)
returns void
language plpgsql
as $$
begin
  perform set_config('app.compliance_lock_note', coalesce(p_note, ''), true);

  update public.categories_l3
  set is_finalized = true
  where id = p_category_id
    and not coalesce(is_finalized, false);

  if not found then
    -- Either it does not exist, is already FINAL, or RLS hid it. All three mean "nothing to do
    -- here", and telling them apart would leak which categories exist.
    raise exception 'That category could not be locked — it may already be marked FINAL.'
      using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.lock_compliance_category(uuid, text) is
  'Mark a category''s TCF requirements FINAL, with an optional note for the history. Open to any authenticated user; releasing is not.';

create or replace function public.release_compliance_category(
  p_category_id uuid,
  p_reason      text
)
returns void
language plpgsql
as $$
declare
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  -- Checked here as well as in the guard so the operator gets this sentence rather than a
  -- trigger's. The guard is still the authority — this is a nicer front door to the same rule.
  if v_reason is null or length(v_reason) < 10 then
    raise exception 'Say why this category is being released — at least 10 characters. It goes on the record.'
      using errcode = 'check_violation';
  end if;

  perform set_config('app.compliance_release_reason', v_reason, true);

  update public.categories_l3
  set is_finalized = false
  where id = p_category_id
    and coalesce(is_finalized, false);

  if not found then
    raise exception 'That category is not marked FINAL.'
      using errcode = 'no_data_found';
  end if;
end;
$$;

comment on function public.release_compliance_category(uuid, text) is
  'Release a FINAL category for editing. ADMIN only and the reason is mandatory — both enforced by categories_l3_final_guard(), which a direct UPDATE cannot get past either.';

-- ===========================================================================
-- 8. Grants and policies
-- ===========================================================================
--
-- Supabase ships `alter default privileges in schema public grant all on tables to anon,
-- authenticated`, so the table created above arrives with INSERT/UPDATE/DELETE already
-- granted to BOTH roles. Revoke first, then grant only what is wanted, so the grant layer
-- agrees with the policy layer instead of leaning on it.

alter table public.compliance_requirement_history enable row level security;

revoke all on public.compliance_requirement_history from anon, authenticated;

-- Read-only for staff. No insert grant at all, for anyone: the triggers are SECURITY DEFINER
-- and owned by the table's owner, so they write straight past both layers. That is the
-- guarantee — a history nobody can forge a row into and nobody can quietly amend.
grant select on public.compliance_requirement_history to authenticated;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename  = 'compliance_requirement_history'
      and policyname = 'compliance_history_read'
  ) then
    create policy "compliance_history_read" on public.compliance_requirement_history
      for select to authenticated using (true);
  end if;
end $$;

revoke all on function public.compliance_actor()                            from public, anon;
revoke all on function public.is_compliance_release_admin()                 from public, anon;
revoke all on function public.lock_compliance_category(uuid, text)          from public, anon;
revoke all on function public.release_compliance_category(uuid, text)       from public, anon;

grant execute on function public.compliance_actor()                          to authenticated;
grant execute on function public.is_compliance_release_admin()               to authenticated;
grant execute on function public.lock_compliance_category(uuid, text)        to authenticated;
grant execute on function public.release_compliance_category(uuid, text)     to authenticated;
