-- 154: Super Admin tier — a flag on top of the existing role, not a fourth role value.
--
-- Why a flag and not role = 'SUPER_ADMIN':
--   ~30 RLS policies across this database hardcode `upper(p.role) = 'ADMIN'`
--   (110, 113, 115, 122, 128, 141, 144, 152, 81, 88, ...). Moving anyone to a new
--   role string would silently strip their admin rights on regulations, print
--   settings, translation memory, feedback and project templates. The flag is
--   additive: a super admin is still an ADMIN everywhere, plus one extra bit.
--
-- What this gates: modules still under test, which should be visible to the
-- person testing them and nobody else. The gate is enforced in the UI (route
-- guard + nav filtering). This migration owns the flag and, critically, who is
-- allowed to SET it.
--
-- The `Update own profile` policy on public.profiles is `auth.uid() = id`, i.e.
-- every authenticated user may write their own row. Without the guard below, any
-- PM could set is_super_admin = true on themselves and walk straight through the
-- gate.

alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

comment on column public.profiles.is_super_admin is
  'Super Admin tier: sees modules still under test. Additive to role; a super admin is still an ADMIN. Settable only by another super admin (see trg_profiles_guard_super_admin_flag).';

-- Recursion-safe predicate. A policy ON profiles cannot contain a plain
-- `select ... from profiles` — that re-enters the same policy and errors with
-- infinite recursion. SECURITY DEFINER bypasses RLS for this one lookup.
create or replace function public.current_user_is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke execute on function public.current_user_is_super_admin() from public;
grant execute on function public.current_user_is_super_admin() to authenticated;

-- Guard: revert any change to is_super_admin made by a caller who is not already
-- a super admin. A silent revert rather than a raise, so an ordinary profile
-- update (name, avatar) from a normal user still succeeds — only the privileged
-- bit is pinned back to its stored value.
create or replace function public.profiles_guard_super_admin_flag()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.is_super_admin is distinct from old.is_super_admin then
    -- service_role and direct SQL (no JWT) bypass the guard: that is the
    -- bootstrap path for the very first super admin, seeded at the bottom.
    if auth.uid() is not null and not public.current_user_is_super_admin() then
      new.is_super_admin := old.is_super_admin;
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.profiles_guard_super_admin_flag() from public;

drop trigger if exists trg_profiles_guard_super_admin_flag on public.profiles;
create trigger trg_profiles_guard_super_admin_flag
  before update on public.profiles
  for each row
  execute function public.profiles_guard_super_admin_flag();

-- Grant path. The only UPDATE policy on profiles is `Update own profile`
-- (auth.uid() = id), so today no one can write anyone else's row — a super admin
-- promoting a colleague would silently affect zero rows. This policy is what
-- makes the Admin Panel toggle real; the trigger above still decides whether the
-- flag itself may move.
drop policy if exists "Super admins update any profile" on public.profiles;
create policy "Super admins update any profile"
  on public.profiles for update
  using (public.current_user_is_super_admin())
  with check (public.current_user_is_super_admin());

-- Seed the first super admin. Runs with no JWT, which the guard exempts.
update public.profiles
   set is_super_admin = true
 where lower(email) = 'f.goncalves@klarstein.com';
