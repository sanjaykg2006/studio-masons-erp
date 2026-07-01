-- Studio-Masons ERP — Step 4 (part 1): Concept / Technical sub-teams inside Design
-- Run AFTER 0021_brief_revisions.sql.
--
-- WHAT THIS ADDS
--   A department can be divided into named SUB-TEAMS. Design gets two, seeded:
--   'concept' (early design, up to the Design Freeze) and 'technical' (detailed
--   work after it). A person on a department's team can belong to either, both,
--   or neither.
--
--   This is the foundation for the Concept <-> Technical privacy rule (each
--   sub-team's tasks/tickets private from the other, with a senior override).
--   The task board that consumes it lands in a later step; here we add the
--   membership model + the visibility helper it will use.

-- 1. Tables -------------------------------------------------------------------

-- The catalogue of sub-teams per department (Design: Concept, Technical).
create table if not exists public.department_subteams (
  id            uuid primary key default gen_random_uuid(),
  department_id uuid not null references public.departments (id) on delete cascade,
  key           text not null,
  label         text not null,
  sort          int  not null default 0,
  is_system     boolean not null default false,
  unique (department_id, key)
);

-- Who is in each sub-team. A person must already be on the department's team
-- (team_members) to be added here (enforced in the RPC below).
create table if not exists public.subteam_members (
  subteam_id uuid not null references public.department_subteams (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  added_by   uuid references public.profiles (id),
  added_at   timestamptz not null default now(),
  primary key (subteam_id, user_id)
);

-- 2. Seed Design's two sub-teams ---------------------------------------------
insert into public.department_subteams (department_id, key, label, sort, is_system)
select public.design_department_id(), v.key, v.label, v.sort, true
from (values ('concept', 'Concept', 1), ('technical', 'Technical', 2))
     as v(key, label, sort)
where public.design_department_id() is not null
on conflict (department_id, key) do nothing;

-- 3. RLS ----------------------------------------------------------------------
alter table public.department_subteams enable row level security;
alter table public.subteam_members     enable row level security;

-- Read the catalogue if you can see the department's team; writes go via RPC.
drop policy if exists "department_subteams_read" on public.department_subteams;
create policy "department_subteams_read" on public.department_subteams
  for select using (
    has_permission('access', 'read') or is_department_lead(department_id)
  );

drop policy if exists "subteam_members_read" on public.subteam_members;
create policy "subteam_members_read" on public.subteam_members
  for select using (
    user_id = auth.uid()
    or exists (
      select 1 from public.department_subteams s
      where s.id = subteam_id
        and (has_permission('access', 'read') or is_department_lead(s.department_id))
    )
  );

-- 4. Read RPCs for the management screen -------------------------------------

-- A department's sub-teams (for the matrix columns).
create or replace function public.list_department_subteams(p_dept uuid)
returns table (id uuid, key text, label text, sort int)
language sql stable security definer set search_path = public
as $$
  select s.id, s.key, s.label, s.sort
  from public.department_subteams s
  where s.department_id = p_dept
    and (public.has_permission('access', 'read') or public.is_department_lead(p_dept))
  order by s.sort;
$$;

-- The department's team members (the matrix rows).
create or replace function public.list_department_team(p_dept uuid)
returns table (user_id uuid, full_name text, email text)
language sql stable security definer set search_path = public
as $$
  select tm.user_id, p.full_name, p.email
  from public.team_members tm
  join public.profiles p on p.id = tm.user_id
  where tm.department_id = p_dept
    and (public.has_permission('access', 'read') or public.is_department_lead(p_dept))
  order by p.full_name nulls last, p.email;
$$;

-- Current sub-team memberships for a department (the ticked cells).
create or replace function public.list_subteam_members(p_dept uuid)
returns table (subteam_id uuid, user_id uuid)
language sql stable security definer set search_path = public
as $$
  select sm.subteam_id, sm.user_id
  from public.subteam_members sm
  join public.department_subteams s on s.id = sm.subteam_id
  where s.department_id = p_dept
    and (public.has_permission('access', 'read') or public.is_department_lead(p_dept));
$$;

-- 5. Write RPC — tick / untick a person's sub-team membership ----------------
create or replace function public.set_subteam_member(
  p_subteam uuid,
  p_user    uuid,
  p_grant   boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_dept uuid;
begin
  select department_id into v_dept
  from public.department_subteams where id = p_subteam;
  if v_dept is null then raise exception 'Sub-team not found'; end if;

  if not public.can_manage_team(v_dept) then
    raise exception 'Not authorized to manage this team';
  end if;
  if not exists (
    select 1 from public.team_members
    where department_id = v_dept and user_id = p_user
  ) then
    raise exception 'Add this person to the department team first';
  end if;

  if p_grant then
    insert into public.subteam_members (subteam_id, user_id, added_by)
    values (p_subteam, p_user, auth.uid())
    on conflict do nothing;
  else
    delete from public.subteam_members
    where subteam_id = p_subteam and user_id = p_user;
  end if;
end;
$$;

-- 6. Visibility helpers (the foundation for private sub-team work) ------------

-- The sub-team ids the caller belongs to.
create or replace function public.my_subteams()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select subteam_id from public.subteam_members where user_id = auth.uid();
$$;

-- May the caller see a given sub-team's private work? True if they're in that
-- sub-team, OR they're a senior in its department (department lead), OR an admin
-- (access:read). This is what the task board / RFI will check per item so that
-- Concept and Technical keep their tasks private from each other by default.
create or replace function public.can_see_subteam_work(p_subteam uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.subteam_members sm
    where sm.subteam_id = p_subteam and sm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.department_subteams s
    where s.id = p_subteam
      and (public.has_permission('access', 'read') or public.is_department_lead(s.department_id))
  );
$$;
