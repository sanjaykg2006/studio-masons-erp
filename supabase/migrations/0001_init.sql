-- Studio-Masons ERP — initial schema
-- Run this in the Supabase SQL Editor (Dashboard -> SQL Editor -> New query).
--
-- Creates a `profiles` table mirroring auth.users, protected by Row-Level
-- Security so each user can only read/update their own profile.
--
-- ACCESS MODEL: invite-only. There is NO auto-create-on-signup. Accounts are
-- pre-provisioned by an admin (and, later, by Microsoft Entra ID SSO). A user
-- without a profile row is simply an authenticated identity with no app data.

-- 1. Profiles table -----------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  role        text not null default 'staff',  -- room for RBAC later (e.g. 'admin')
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 2. Row-Level Security -------------------------------------------------------
-- Users can read/update only their own profile. INSERTs are intentionally not
-- allowed to end users — provisioning is done by an admin (service role in the
-- SQL editor / dashboard bypasses RLS), or later by SSO provisioning.
alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- 3. Keep updated_at fresh ----------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- PROVISIONING A USER (manual, until Microsoft 365 SSO is wired up)
--
-- Step 1: Create the login in the dashboard:
--           Authentication -> Users -> Add user -> enter email + password,
--           and tick "Auto Confirm User" so you can sign in immediately.
--
-- Step 2: Give that user an app profile by running the snippet below with
--         their email (this links the profile to the auth user by email):
--
--   insert into public.profiles (id, email, full_name, role)
--   select id, email, 'Your Name', 'admin'
--   from auth.users
--   where email = 'you@studio-masons.com'
--   on conflict (id) do nothing;
-- ---------------------------------------------------------------------------
