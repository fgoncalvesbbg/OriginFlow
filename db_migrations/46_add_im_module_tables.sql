-- Migration 46: Add Instruction Manual (IM) module tables
-- Run this in the Supabase SQL editor to enable the IM module

-- IM Templates
create table if not exists public.im_templates (
  id uuid default uuid_generate_v4() primary key,
  category_id text references public.categories_l3(id) on delete cascade,
  name text not null,
  languages text[] default '{en}'::text[],
  is_finalized boolean default false,
  finalized_at timestamp with time zone,
  metadata jsonb default '{}'::jsonb,
  last_updated_by text,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- IM Sections (with condition columns for conditional chapters)
create table if not exists public.im_sections (
  id uuid default uuid_generate_v4() primary key,
  template_id uuid references public.im_templates(id) on delete cascade,
  parent_id uuid references public.im_sections(id) on delete cascade,
  title text not null,
  "order" integer default 0,
  is_placeholder boolean default false,
  content jsonb default '{}'::jsonb,
  condition_attribute_id text,
  condition_value text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Project IM Instances
create table if not exists public.project_ims (
  id uuid default uuid_generate_v4() primary key,
  project_id uuid references public.projects(id) on delete cascade,
  template_id uuid references public.im_templates(id),
  status text default 'draft',
  placeholder_data jsonb default '{}'::jsonb,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Enable RLS
alter table public.im_templates enable row level security;
alter table public.im_sections enable row level security;
alter table public.project_ims enable row level security;

-- Policies (skip if already exist)
do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'im_templates' and policyname = 'Enable all for im templates'
  ) then
    execute 'create policy "Enable all for im templates" on public.im_templates for all using (auth.role() = ''authenticated'')';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'im_sections' and policyname = 'Enable all for im sections'
  ) then
    execute 'create policy "Enable all for im sections" on public.im_sections for all using (auth.role() = ''authenticated'')';
  end if;
end $$;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'project_ims' and policyname = 'Enable all for project ims'
  ) then
    execute 'create policy "Enable all for project ims" on public.project_ims for all using (auth.role() = ''authenticated'')';
  end if;
end $$;
