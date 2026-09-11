-- Studio-Masons ERP — "a role on every project" now works on every screen.
-- Run AFTER 0079_project_templates_on_project_roles.sql.
--
-- WHAT WAS WRONG
--   People & Access can give a person one role on every project (the
--   all-projects switch). 0074 made the page GUARD (has_project_permission)
--   honour it on every project, whichever department owns it. Four other rules
--   were never brought along, so the switch half-worked and people had to be
--   added to each project by hand to get the rest:
--
--   * my_project_permissions — what the project page uses to SHOW buttons —
--     still counted the switch only on projects owned by the person's own
--     department. Design owns the projects, so a Project Management Project
--     Director saw the page but none of their buttons. (Prem Kumar was added to
--     both projects by hand on 2026-09-11 for exactly this.)
--   * design_project_members_view — the project's team list — listed only
--     hand-added members, so every-project people did not appear at all.
--   * can_manage_project_member (the project_members write policy),
--     design_roles and design_assignable_users — staffing a project — ignored
--     the switch, so an every-project role with Membership · Manage passed the
--     app's check and was then refused by the database.
--
-- THE FIX
--   Each of them now reads the switch the same way has_project_permission does:
--   on every project, whichever department owns it. Two helpers hold "which
--   roles does the caller hold" so the rule is written once, not four times.

-- ── 1. Which roles the caller holds ──────────────────────────────────────────
-- On one project: hand-added membership, plus the every-project role.
create or replace function public.my_project_role_ids(p_project uuid)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select m.role_id
  from public.project_members m
  where m.project_id = p_project and m.user_id = auth.uid()
  union
  select tm.all_projects_role_id
  from public.team_members tm
  where tm.user_id = auth.uid()
    and tm.all_projects
    and tm.all_projects_role_id is not null;
$$;

-- Anywhere: on any project, plus the every-project role.
create or replace function public.my_role_ids_anywhere()
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select m.role_id
  from public.project_members m
  where m.user_id = auth.uid()
  union
  select tm.all_projects_role_id
  from public.team_members tm
  where tm.user_id = auth.uid()
    and tm.all_projects
    and tm.all_projects_role_id is not null;
$$;

-- ── 2. The buttons on a project page ─────────────────────────────────────────
-- Same union as has_project_permission (0074): no owning-department filter.
create or replace function public.my_project_permissions(p_project uuid)
returns table (resource text, action public.app_action)
language sql stable security definer set search_path = public
as $$
  select rp.resource, rp.action
  from public.profiles p
  join public.role_permissions rp on rp.role_id = p.role_id
  where p.id = auth.uid()
  union
  select tmp.resource, tmp.action
  from public.team_member_permissions tmp
  where tmp.user_id = auth.uid()
  union
  select rp.resource, rp.action
  from public.role_permissions rp
  where rp.role_id in (select public.my_project_role_ids(p_project));
$$;

-- ── 3. Staffing a project ────────────────────────────────────────────────────
-- A person may place someone in a role of department D if they hold, on this
-- project (hand-added or every-project), a D role with Membership · Manage.
create or replace function public.can_manage_project_member(p_project uuid, p_role uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.has_permission('project.member', 'manage')
    or public.is_department_lead((select department_id from public.roles where id = p_role))
    or exists (
      select 1
      from public.roles r
      join public.role_permissions rp on rp.role_id = r.id
      where r.id in (select public.my_project_role_ids(p_project))
        and rp.action = 'manage'
        and rp.resource in ('project.member', '*')
        and r.department_id = (select department_id from public.roles where id = p_role)
    );
$$;

-- The role picker: the departments whose people the caller may place.
create or replace function public.design_roles()
returns table (id uuid, label text)
language sql stable security definer set search_path = public
as $$
  select r.id, r.label
  from public.roles r
  join public.departments d on d.id = r.department_id
  where (
      public.has_permission('project.member', 'manage')
      or public.is_department_lead(d.id)
      or exists (
        select 1
        from public.roles mr
        join public.role_permissions rp on rp.role_id = mr.id
        where mr.id in (select public.my_role_ids_anywhere())
          and rp.action = 'manage'
          and rp.resource in ('project.member', '*')
          and mr.department_id = r.department_id
      )
    )
  order by r.label;
$$;

-- The people picker: everyone, for anyone who may staff some project.
create or replace function public.design_assignable_users()
returns table (id uuid, full_name text, email text)
language sql stable security definer set search_path = public
as $$
  select p.id, p.full_name, p.email
  from public.profiles p
  where public.has_permission_anywhere('project.member', 'manage')
     or public.leads_any_department();
$$;

-- ── 4. The team list shows every-project people too ──────────────────────────
-- Marked every_project so the page labels them and offers no "remove": they
-- are switched off on People & Access, not per project. A person who is also
-- hand-added shows once, as their hand-added role.
--
-- It also returns the role's NAME. The page used to look names up in the
-- add-member picker, which lists only the roles the viewer may hand out, so
-- anyone without staffing rights saw "—" for every role.
drop function if exists public.design_project_members_view(uuid);
create function public.design_project_members_view(p_project uuid)
returns table (
  user_id uuid, full_name text, email text,
  role_id uuid, role_label text, every_project boolean
)
language sql stable security definer set search_path = public
as $$
  select m.user_id, p.full_name, p.email, m.role_id, r.label, false
  from public.project_members m
  join public.profiles p on p.id = m.user_id
  join public.roles r on r.id = m.role_id
  where m.project_id = p_project
    and public.can_view_project(p_project)
  union all
  select * from (
    select distinct on (tm.user_id)
           tm.user_id, p.full_name, p.email, tm.all_projects_role_id, r.label, true
    from public.team_members tm
    join public.profiles p on p.id = tm.user_id
    join public.roles r on r.id = tm.all_projects_role_id
    where tm.all_projects
      and tm.all_projects_role_id is not null
      and public.can_view_project(p_project)
      and not exists (
        select 1 from public.project_members m
        where m.project_id = p_project and m.user_id = tm.user_id
      )
    order by tm.user_id
  ) every_project;
$$;

grant execute on function public.design_project_members_view(uuid) to authenticated;
