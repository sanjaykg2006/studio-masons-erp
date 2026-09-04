-- Studio-Masons ERP — RBAC tidy-up + a configurable Concept-phase visibility matrix
-- Run AFTER 0071_billing_branches_own_the_po.sql.
--
-- THREE THINGS, from the access review:
--
-- 1. RESTORE THE BACK-OFFICE RULE. 0014 established that a back-office role — a
--    job title with no department — may hold ONLY back-office (general) modules,
--    never a department/project module and never the '*' wildcard. 0031 rewrote
--    guard_role_permission to also block 'access' on department roles and, in
--    doing so, dropped 0014's branch: job titles have been leaving the guard
--    unchecked ever since, so one could be granted '*'. Only an admin could do
--    it, and no job title holds anything today, but the rule was not enforced.
--    Both branches now coexist.
--
--    ('access' stays flagged general on purpose — that is what lets an HR-style
--    job title be given Access Control without making them a full admin. It can
--    still never leak in through a department: the department branch rejects it
--    before is_general is ever consulted.)
--
-- 2. CLEAR is_department_wide ON DEPARTMENT ROLES. The flag now feeds only
--    folder_capability_level, where it means "this person's capability applies
--    on EVERY project". It is read from a person's JOB TITLE (profiles.role_id),
--    so a department role carrying it would hand folder rights across every
--    project to anyone given that job title. Nobody is in that state today.
--    Company-wide reach stays where it belongs: the Administrator and Managing
--    Director system roles.
--
-- 3. CONCEPT VISIBILITY BECOMES A MATRIX. can_view_project hardcoded "during
--    Concept, only the owning department's team" — a policy decision baked into
--    a function. It is now a table the company edits: owning department ×
--    viewing department. Seeded with the diagonal, so behaviour on the day this
--    runs is identical to before.

-- ── 1. The role guard: both branches ─────────────────────────────────────────
create or replace function public.guard_role_permission()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_dept   uuid;
  v_system boolean;
begin
  select department_id, is_system into v_dept, v_system
  from public.roles where id = new.role_id;

  -- System roles (Administrator, Staff, MD) are unrestricted by design.
  if v_system then
    return new;
  end if;

  if v_dept is null then
    -- Back office job title (0014): general modules only, never the wildcard.
    if new.resource = '*' then
      raise exception 'Wildcard access is reserved for system roles';
    end if;
    if exists (
      select 1 from public.module_settings
      where module_id = new.resource and is_general
    ) then
      return new;
    end if;
    raise exception
      'Module "%" is not a back-office module. Back office job titles can only be granted back-office screens.',
      new.resource;
  end if;

  -- Department role (0031): "*" and "access" are Door 1 only. Checked BEFORE
  -- is_general, so flagging Access Control general can never open a back door.
  if new.resource in ('*', 'access') then
    raise exception 'This power cannot be granted to a department role';
  end if;

  if exists (
    select 1 from public.module_settings
    where module_id = new.resource and is_general
  ) then
    return new;
  end if;

  if exists (
    select 1 from public.department_modules
    where department_id = v_dept and module_id = new.resource
  ) then
    return new;
  end if;

  raise exception
    'Module "%" is not available to this role''s department', new.resource;
end;
$$;

-- ── 2. Company-wide reach belongs to system roles only ───────────────────────
update public.roles
   set is_department_wide = false
 where department_id is not null
   and is_department_wide;

-- ── 3. Concept-phase visibility matrix ───────────────────────────────────────
-- A row means: while a project owned by `owner_department_id` is still in
-- Concept, a member holding a role from `viewer_department_id` may see it.
-- Absence = not until the Design Freeze. Membership AND a project:read role are
-- still required either way, so this widens nothing on its own.
create table if not exists public.project_concept_visibility (
  owner_department_id  uuid not null references public.departments (id) on delete cascade,
  viewer_department_id uuid not null references public.departments (id) on delete cascade,
  primary key (owner_department_id, viewer_department_id)
);

alter table public.project_concept_visibility enable row level security;

-- Readable by any signed-in user: it is a grid of department names, and
-- can_view_project (SECURITY DEFINER) reads it for everyone anyway.
drop policy if exists "project_concept_visibility_read" on public.project_concept_visibility;
create policy "project_concept_visibility_read" on public.project_concept_visibility
  for select using (auth.uid() is not null);

drop policy if exists "project_concept_visibility_write" on public.project_concept_visibility;
create policy "project_concept_visibility_write" on public.project_concept_visibility
  for all using (has_permission('access', 'update'))
  with check (has_permission('access', 'update'));

-- Seed the diagonal: every department sees its own projects during Concept —
-- exactly the rule this replaces. Nothing changes until someone edits it.
insert into public.project_concept_visibility (owner_department_id, viewer_department_id)
select d.id, d.id from public.departments d
on conflict do nothing;

-- Hold that true for departments created later, so a new department can always
-- see its own work without anyone remembering to tick a box.
create or replace function public.seed_concept_visibility_self()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.project_concept_visibility (owner_department_id, viewer_department_id)
  values (new.id, new.id)
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists departments_seed_concept_visibility on public.departments;
create trigger departments_seed_concept_visibility
  after insert on public.departments
  for each row execute function public.seed_concept_visibility_self();

-- The visibility gate, now reading the matrix instead of comparing two ids.
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
    -- Members with a project:read role. After the Design Freeze (EXECUTION)
    -- every assigned team sees it; during CONCEPT the matrix decides.
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
        and (
          pr.phase = 'execution'
          or exists (
            select 1 from public.project_concept_visibility v
            where v.owner_department_id  = pr.department_id
              and v.viewer_department_id = r.department_id
          )
        )
    );
$$;

-- ── Read + write the matrix ──────────────────────────────────────────────────
create or replace function public.list_concept_visibility()
returns table (owner_department_id uuid, viewer_department_id uuid)
language sql stable security definer set search_path = public as $$
  select owner_department_id, viewer_department_id
  from public.project_concept_visibility
  where public.has_permission('access', 'read');
$$;

create or replace function public.set_concept_visibility(
  p_owner uuid, p_viewer uuid, p_allowed boolean
)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission('access', 'update') then
    raise exception 'Not authorized to change project visibility';
  end if;
  -- A department always sees its own projects; removing that would strand the
  -- team that owns the work.
  if p_owner = p_viewer and not p_allowed then
    raise exception 'A department always sees its own projects during Concept';
  end if;
  if p_allowed then
    insert into public.project_concept_visibility (owner_department_id, viewer_department_id)
    values (p_owner, p_viewer) on conflict do nothing;
  else
    delete from public.project_concept_visibility
    where owner_department_id = p_owner and viewer_department_id = p_viewer;
  end if;
end;
$$;
