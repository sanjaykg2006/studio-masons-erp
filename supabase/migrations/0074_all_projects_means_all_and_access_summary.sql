-- Studio-Masons ERP — make "works on all projects" mean what it says, and let
-- Access Control show one person's whole access in one place.
-- Run AFTER 0073_amendment_cancel_receipts_and_delete_blockers.sql.
--
-- 1. THE BUG: TWO FUNCTIONS DISAGREED
--    The "works on all projects" switch was read by two different rules.
--    can_view_project (the project LIST and its RLS) accepted it outright, while
--    has_project_permission (the page GUARD) additionally required the person's
--    department to be the one that OWNS the project — a filter 0031 added to
--    can_view_project's sibling but never to can_view_project itself.
--
--    So a Project Director with the switch on could SEE a Design-owned project
--    in the list and was refused the moment they opened it. Worse, since Design
--    owns the projects, the switch reached nothing at all for any other
--    department — it silently did nothing.
--
--    The owning department tags a project; it does not describe who works on it.
--    Procurement, Finance and Project Management all work on projects Design
--    owns, so scoping a company-wide switch to the owning department made it
--    useless for exactly the departments it exists for. The filter goes, and the
--    two rules now agree: all projects means all projects.
--
--    This is not a wider door than the switch already advertised. Granting it
--    still requires managing that department's team, and guard_team_member_role
--    still insists the chosen role belongs to that department.
--
-- 2. ONE PLACE TO READ SOMEONE'S ACCESS
--    Access lives in four places by design — job title, department team grants,
--    the all-projects switch, and per-project roles. Answering "what can this
--    person actually do?" meant opening four screens and doing the union in your
--    head. user_access_summary does that join once, for reading only.
--
--    It introduces NO rule and NO new matrix: every figure below is read from
--    the tables the existing screens already write, and nothing here is
--    consulted when access is enforced. Editing stays where it has always been.

-- ── 1. All projects means all projects ───────────────────────────────────────
create or replace function public.has_project_permission(
  p_project  uuid,
  p_resource text,
  p_action   public.app_action
)
returns boolean
language sql stable security definer set search_path = public
as $$
  select
    public.has_permission(p_resource, p_action)
    or exists (
      select 1
      from public.project_members m
      join public.role_permissions rp on rp.role_id = m.role_id
      where m.project_id = p_project
        and m.user_id = auth.uid()
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    )
    -- No owning-department filter: this is the company-wide switch, and
    -- can_view_project has always read it this way.
    or exists (
      select 1
      from public.team_members tm
      join public.role_permissions rp on rp.role_id = tm.all_projects_role_id
      where tm.user_id = auth.uid()
        and tm.all_projects
        and rp.action = p_action
        and rp.resource in (p_resource, '*')
    );
$$;

-- ── 2. Everything that decides one person's access, in one read ──────────────
create or replace function public.user_access_summary(p_user uuid)
returns jsonb
language sql stable security definer set search_path = public
as $$
  select case when not public.has_permission('access', 'read') then null else
    jsonb_build_object(
      'profile', (
        select jsonb_build_object(
          'id', p.id, 'email', p.email, 'full_name', p.full_name,
          'deactivated_at', p.deactivated_at)
        from public.profiles p where p.id = p_user
      ),

      -- Plane 1: the job title, and what it grants company-wide.
      'role', (
        select jsonb_build_object(
          'label', r.label,
          'is_system', r.is_system,
          'department', d.label,
          'permissions', coalesce((
            select jsonb_agg(jsonb_build_object('resource', rp.resource, 'action', rp.action)
                             order by rp.resource, rp.action)
            from public.role_permissions rp where rp.role_id = r.id
          ), '[]'::jsonb))
        from public.profiles p
        join public.roles r on r.id = p.role_id
        left join public.departments d on d.id = r.department_id
        where p.id = p_user
      ),

      -- Plane 2: department teams, the per-person ticks, and the all-projects switch.
      'teams', coalesce((
        select jsonb_agg(jsonb_build_object(
          'department', d.label,
          'all_projects', tm.all_projects,
          'all_projects_role', ar.label,
          'permissions', coalesce((
            select jsonb_agg(jsonb_build_object('resource', tmp.resource, 'action', tmp.action)
                             order by tmp.resource, tmp.action)
            from public.team_member_permissions tmp
            where tmp.user_id = tm.user_id and tmp.department_id = tm.department_id
          ), '[]'::jsonb),
          'is_lead', exists (
            select 1 from public.department_leads dl
            where dl.user_id = tm.user_id and dl.department_id = tm.department_id
          )) order by d.label)
        from public.team_members tm
        join public.departments d on d.id = tm.department_id
        left join public.roles ar on ar.id = tm.all_projects_role_id
        where tm.user_id = p_user
      ), '[]'::jsonb),

      -- Plane 3: the projects they are actually a member of, and as what.
      'projects', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', pr.id, 'name', pr.name, 'code', pr.code, 'phase', pr.phase,
          'owner_department', od.label,
          'role', r.label,
          'role_department', rd.label) order by pr.name)
        from public.project_members m
        join public.projects pr on pr.id = m.project_id
        join public.roles r on r.id = m.role_id
        left join public.departments od on od.id = pr.department_id
        left join public.departments rd on rd.id = r.department_id
        where m.user_id = p_user
      ), '[]'::jsonb),

      -- The union the app actually enforces company-wide: role grants plus team
      -- grants. Exactly what has_permission() reads, listed rather than guessed.
      'effective', coalesce((
        select jsonb_agg(x order by x->>'resource', x->>'action')
        from (
          select distinct jsonb_build_object(
            'resource', rp.resource, 'action', rp.action, 'via', 'Job title') as x
          from public.profiles p
          join public.role_permissions rp on rp.role_id = p.role_id
          where p.id = p_user
          union
          select distinct jsonb_build_object(
            'resource', tmp.resource, 'action', tmp.action,
            'via', 'Team · ' || d.label) as x
          from public.team_member_permissions tmp
          join public.departments d on d.id = tmp.department_id
          where tmp.user_id = p_user
        ) t
      ), '[]'::jsonb)
    )
  end;
$$;
