-- Studio-Masons ERP — Step 3: project lifecycle (Concept / Execution + Design Freeze)
-- Run AFTER 0019_template_scope.sql.
--
-- WHAT THIS ADDS
--   * A two-phase lifecycle on every project: CONCEPT -> EXECUTION.
--   * The Design Freeze: a deliberate, audited handoff (a project:approve holder
--     flips the project to Execution). It stamps frozen_at / frozen_by.
--   * Concept privacy: during Concept the project is visible ONLY to the owning
--     department's team (+ department-wide / all-projects seniors). After the
--     Freeze it opens up to every assigned team, regardless of department.
--   * Design lock: once frozen, briefs are read-only ("no informal changes after
--     the Freeze — raise a change order instead").
--
-- The Freeze/unfreeze themselves are plain project UPDATEs done in the server
-- action (reusing the project:approve grant, like finalise), so no new RPC or
-- permission is introduced. This migration only adds the columns, the phase-aware
-- visibility gate, and the brief lock.

-- 1. Phase columns ------------------------------------------------------------
do $$ begin
  create type public.project_phase as enum ('concept', 'execution');
exception when duplicate_object then null; end $$;

alter table public.projects
  add column if not exists phase     public.project_phase not null default 'concept',
  add column if not exists frozen_at timestamptz,
  add column if not exists frozen_by uuid references auth.users (id);

-- Existing finalised projects predate the Freeze: treat them as already in
-- Execution so their teams don't suddenly lose sight of them under the new
-- Concept-privacy rule.
update public.projects
  set phase = 'execution',
      frozen_at = coalesce(frozen_at, finalised_at, now())
  where status = 'finalised' and phase <> 'execution';

-- 2. Concept-privacy visibility gate ------------------------------------------
-- Who may SEE a project at all. This is the phase-aware wrapper around the plain
-- project:read check, used by every "can you see this project" read path.
create or replace function public.can_view_project(p_project uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    -- Department-wide / global project:read grantees see every project.
    public.has_permission('project', 'read')
    -- "Sees all projects" seniors (team all_projects with a project:read role).
    or exists (
      select 1
      from public.team_members tm
      join public.role_permissions rp on rp.role_id = tm.all_projects_role_id
      where tm.user_id = auth.uid()
        and tm.all_projects
        and rp.action = 'read'
        and rp.resource in ('project', '*')
    )
    -- Members with a project:read role: during CONCEPT only the OWNING
    -- department's team; after the Design Freeze (EXECUTION) all assigned teams.
    or exists (
      select 1
      from public.project_members m
      join public.roles r             on r.id  = m.role_id
      join public.role_permissions rp on rp.role_id = m.role_id
      join public.projects pr         on pr.id = m.project_id
      where m.project_id = p_project
        and m.user_id = auth.uid()
        and rp.action = 'read'
        and rp.resource in ('project', '*')
        and (pr.phase = 'execution' or r.department_id = pr.department_id)
    );
$$;

-- 3. Route the read-visibility policies through the phase-aware gate -----------
drop policy if exists "projects_select" on public.projects;
create policy "projects_select" on public.projects
  for select using (can_view_project(id));

drop policy if exists "project_members_select" on public.project_members;
create policy "project_members_select" on public.project_members
  for select using (can_view_project(project_id));

drop policy if exists "project_steps_select" on public.project_steps;
create policy "project_steps_select" on public.project_steps
  for select using (can_view_project(project_id));

drop policy if exists "project_change_requests_select" on public.project_change_requests;
create policy "project_change_requests_select" on public.project_change_requests
  for select using (can_view_project(project_id));

-- The two SECURITY DEFINER read RPCs gate on the same "can you see it" rule.
create or replace function public.design_project_folders(p_project uuid)
returns table (
  folder_key  text,
  label       text,
  sort        int,
  description text,
  rank        int,
  locked      boolean
)
language sql stable security definer set search_path = public
as $$
  select ft.key, ft.label, ft.sort, ft.description,
         public.design_folder_rank(p_project, ft.key),
         public.is_folder_locked(p_project, ft.key)
  from public.design_folder_types ft
  where public.can_view_project(p_project)
  order by ft.sort;
$$;

create or replace function public.design_project_members_view(p_project uuid)
returns table (user_id uuid, full_name text, email text, role_id uuid)
language sql stable security definer set search_path = public
as $$
  select m.user_id, p.full_name, p.email, m.role_id
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  where m.project_id = p_project
    and public.can_view_project(p_project);
$$;

-- 4. Design lock: briefs are read-only once the project is frozen -------------
create or replace function public.guard_brief_answer_lock()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_status public.design_brief_status;
  v_phase  public.project_phase;
begin
  select b.status, pr.phase
    into v_status, v_phase
  from public.project_briefs b
  join public.projects pr on pr.id = b.project_id
  where b.id = coalesce(new.brief_id, old.brief_id);

  if auth.uid() is not null then
    if v_status = 'approved' then
      raise exception 'This brief is approved and locked for editing';
    elsif v_phase = 'execution' then
      raise exception 'The design is frozen — raise a change order to modify the brief';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;
