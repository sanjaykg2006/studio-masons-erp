-- Studio-Masons ERP — where each module is set becomes a setting, not code.
-- Run AFTER 0085_it_department.sql.
--
-- WHAT CHANGES
--   Whether a module is given with the job title (company-wide), ticked per
--   person on a department's People & Access (a department tool), or ticked per
--   role on a department's Settings → Project roles (project work) was decided
--   by flags in the code. It is now stored here, in module_settings.home, and
--   Access Control's "Where each module is set" card edits it.
--
--   The code still says which places each module MAY be set, because that is a
--   fact about how its screens check access: the vendor list never reads project
--   roles, so a Project-roles tick on it would do nothing. The app only offers
--   those places; this table records which one is chosen.
--
--   is_general — read by the role guards — is kept equal to (home = 'company')
--   by a trigger, so every existing check keeps working unchanged.
--
--   Moving a module clears the ticks left in its old place, so none linger
--   unseen, and the two tick RPCs refuse a module that is not set there.
--
-- STARTING POINT
--   Every module keeps its current place. The one exception is Design's folder
--   catalogue, which had no place at all: it starts on job titles (its stray
--   Design project-role ticks, which nothing read, are cleared).

alter table public.module_settings
  add column if not exists home text
  check (home in ('company', 'department', 'project'));

update public.module_settings set home = case
  when is_general then 'company'
  when module_id = 'design.folder' then 'company'
  when module_id = 'folder.access' then null      -- its own grid, not a choice
  when module_id in (
    'project', 'project.brief', 'project.member', 'project.template',
    'procurement.budget', 'procurement.intent', 'procurement.order', 'procurement.receipt',
    'inventory.stock',
    'finance.invoice', 'finance.payment', 'finance.retention', 'finance.advance'
  ) then 'project'
  else 'department'
end;

create or replace function public.sync_module_general()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.home is not null then
    new.is_general := (new.home = 'company');
  elsif new.is_general then
    new.home := 'company';
  end if;
  return new;
end;
$$;

drop trigger if exists module_settings_sync on public.module_settings;
create trigger module_settings_sync
  before insert or update on public.module_settings
  for each row execute function public.sync_module_general();

-- Fire it once over the backfill (design.folder becomes general).
update public.module_settings set home = home;

delete from public.role_permissions rp
using public.roles r
where r.id = rp.role_id
  and r.department_id is not null
  and not r.is_system
  and rp.resource = 'design.folder';

-- ── Access Control's "Where each module is set" ─────────────────────────────
create or replace function public.set_module_home(p_module text, p_home text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_permission('access', 'update') then
    raise exception 'Not authorized to change where modules are set';
  end if;
  if p_home not in ('company', 'department', 'project') then
    raise exception 'Unknown place';
  end if;

  insert into public.module_settings (module_id, home)
  values (p_module, p_home)
  on conflict (module_id) do update set home = excluded.home;

  -- Clear ticks left in the places the module no longer lives.
  if p_home <> 'company' then
    delete from public.role_permissions rp
    using public.roles r
    where r.id = rp.role_id and r.department_id is null and not r.is_system
      and rp.resource = p_module;
  end if;
  if p_home <> 'department' then
    delete from public.team_member_permissions where resource = p_module;
  end if;
  if p_home <> 'project' then
    delete from public.role_permissions rp
    using public.roles r
    where r.id = rp.role_id and r.department_id is not null and not r.is_system
      and rp.resource = p_module;
  end if;
end;
$$;

-- ── The tick RPCs refuse a module that isn't set there ───────────────────────
-- People & Access (0085), plus the home check on granting.
create or replace function public.set_team_member_permission(
  p_dept     uuid,
  p_user     uuid,
  p_resource text,
  p_action   public.app_action,
  p_grant    boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_manage_team(p_dept) then
    raise exception 'Not authorized to manage this team';
  end if;
  if p_resource = 'access' and not public.has_full_access() then
    raise exception 'Only a full-access administrator can hand out Access Control';
  end if;
  if p_resource in ('department.people', 'department.settings')
     and not (public.is_department_lead(p_dept) or public.has_permission('access', 'update'))
  then
    raise exception 'Only the department lead can hand out People & Access or Settings';
  end if;
  if p_grant and exists (
    select 1 from public.module_settings
    where module_id = p_resource and home is not null and home <> 'department'
  ) then
    raise exception 'This module is not set on People & Access — see Access Control → Where each module is set';
  end if;
  if not exists (
    select 1 from public.team_members
    where department_id = p_dept and user_id = p_user
  ) then
    raise exception 'Add this person to the team first';
  end if;
  if not public.is_department_ability(p_resource)
     and not exists (
       select 1 from public.department_modules
       where department_id = p_dept and module_id = p_resource
     )
  then
    raise exception 'Module "%" is not available to this department', p_resource;
  end if;

  if p_grant then
    insert into public.team_member_permissions (department_id, user_id, resource, action)
    values (p_dept, p_user, p_resource, p_action)
    on conflict do nothing;
  else
    delete from public.team_member_permissions
    where department_id = p_dept and user_id = p_user
      and resource = p_resource and action = p_action;
  end if;
end;
$$;

-- Settings → Project roles (0028), plus the home check on granting.
create or replace function public.set_department_role_permission(
  p_role     uuid,
  p_resource text,
  p_action   public.app_action,
  p_grant    boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_dept uuid;
begin
  select department_id into v_dept from public.roles where id = p_role;
  if v_dept is null then raise exception 'Unknown role'; end if;
  if not public.can_manage_department_roles(v_dept) then
    raise exception 'Not authorized to manage this department''s roles';
  end if;
  if p_grant and exists (
    select 1 from public.module_settings
    where module_id = p_resource and home is not null and home <> 'project'
  ) then
    raise exception 'This module is not set per project role — see Access Control → Where each module is set';
  end if;

  if p_grant then
    insert into public.role_permissions (role_id, resource, action)
    values (p_role, p_resource, p_action) on conflict do nothing;
  else
    delete from public.role_permissions
    where role_id = p_role and resource = p_resource and action = p_action;
  end if;
end;
$$;
