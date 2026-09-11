-- Studio-Masons ERP — an IT department owns Access Control, the Activity Log and
-- the Error Log.
-- Run AFTER 0084_skip_senior_approval.sql.
--
-- WHAT CHANGES
--   The three screens were back-office (general) modules, granted on job titles.
--   Nobody but a full-access Administrator held them. They now belong to a new
--   IT department: their ticks live on IT's People & Access page and nowhere
--   else, and IT's home page links to them. (The sidebar links stay.)
--
-- THE SAFETY RULE
--   Whoever holds Access Control can change anyone's access, their own
--   included. 0031 therefore refused it through any department. It is now
--   allowed through IT only, and only a full-access Administrator may hand it
--   out — not the IT lead, who could otherwise make themselves an
--   administrator. Granting is enforced in the table's guard trigger (so a
--   direct write cannot slip past) and, with a friendlier message, in the RPC,
--   which also keeps taking it away to administrators. (Removing the tick only
--   ever reduces access, so the lead's direct delete is left as it was.) The IT
--   lead hands out the Activity Log and Error Log like any department tool.
--
-- WHO IS AFFECTED
--   Nobody loses access: no job title holds these today. The one stray grant —
--   Access Control: Edit on Design's Senior Project Architect project role,
--   which no rule ever read — is removed.

insert into public.departments (key, label, description, is_system)
select 'it', 'IT', 'Runs access control and watches the activity and error logs.', false
where not exists (select 1 from public.departments where key = 'it');

insert into public.module_settings (module_id, is_general) values
  ('access', false), ('audit', false), ('errorlog', false)
on conflict (module_id) do update set is_general = false;

insert into public.department_modules (department_id, module_id)
select d.id, m.module_id
from public.departments d
cross join (values ('access'), ('audit'), ('errorlog')) as m(module_id)
where d.key = 'it'
on conflict do nothing;

delete from public.role_permissions rp
using public.roles r
where r.id = rp.role_id
  and not r.is_system
  and rp.resource in ('access', 'audit', 'errorlog');

-- The guard on every team tick (0078), with the Access Control rule.
create or replace function public.guard_team_member_permission()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.resource = '*' then
    raise exception 'This power cannot be granted through a department';
  end if;
  if new.resource = 'access' then
    if not exists (
      select 1 from public.departments where id = new.department_id and key = 'it'
    ) then
      raise exception 'Access Control can only be given through the IT department';
    end if;
    if not public.has_full_access() then
      raise exception 'Only a full-access administrator can hand out Access Control';
    end if;
  end if;
  if public.is_department_ability(new.resource) then
    return new;
  end if;
  if exists (
    select 1 from public.department_modules
    where department_id = new.department_id and module_id = new.resource
  ) then
    return new;
  end if;
  raise exception 'Module "%" is not available to this department', new.resource;
end;
$$;

-- The People & Access tick RPC (0078), with the same rule up front — for
-- taking the tick away as well as giving it.
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
