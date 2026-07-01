-- Studio-Masons ERP — a generic department workspace (roles for ANY department)
-- Run AFTER 0027_task_invites_list.sql.
--
-- WHAT THIS ADDS
--   Until now, project-role management (create / order / permissions) was
--   Design-only. This generalises it so any department — Project Management, and
--   future ones — can manage its own roles from its own settings screen. Each RPC
--   is gated by can_manage_department_roles(dept): the department's lead, or an
--   access admin. The 0004 guard still limits a role to its department's modules.

-- 1. Who may configure a department's roles? ----------------------------------
create or replace function public.can_manage_department_roles(p_dept uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.is_department_lead(p_dept)
      or public.has_permission('access', 'update');
$$;

-- 2. The departments the caller belongs to (workspace list + nav gate) --------
create or replace function public.my_departments()
returns table (id uuid, key text, label text, is_lead boolean, can_manage boolean)
language sql stable security definer set search_path = public
as $$
  select d.id, d.key, d.label,
         public.is_department_lead(d.id),
         public.can_manage_department_roles(d.id)
  from public.departments d
  where public.is_department_lead(d.id)
     or public.has_permission('access', 'read')
     or exists (
       select 1 from public.team_members tm
       where tm.department_id = d.id and tm.user_id = auth.uid()
     )
  order by d.label;
$$;

-- 3. Reads — a department's roles + their grants ------------------------------
create or replace function public.department_roles(p_dept uuid)
returns table (id uuid, key text, label text, description text, is_system boolean, rank int)
language sql stable security definer set search_path = public
as $$
  select r.id, r.key, r.label, r.description, r.is_system, r.rank
  from public.roles r
  where r.department_id = p_dept
    and public.can_manage_department_roles(p_dept)
  order by r.rank, r.label;
$$;

create or replace function public.department_role_permissions(p_dept uuid)
returns table (role_id uuid, resource text, action public.app_action)
language sql stable security definer set search_path = public
as $$
  select rp.role_id, rp.resource, rp.action
  from public.role_permissions rp
  join public.roles r on r.id = rp.role_id
  where r.department_id = p_dept
    and public.can_manage_department_roles(p_dept);
$$;

-- 4. Writes — create / delete / grant / reorder ------------------------------
create or replace function public.create_department_role(p_dept uuid, p_label text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid; v_slug text; v_key text; v_dept_key text; v_rank int;
begin
  if not public.can_manage_department_roles(p_dept) then
    raise exception 'Not authorized to manage this department''s roles';
  end if;

  v_slug := regexp_replace(lower(trim(coalesce(p_label, ''))), '[^a-z0-9]+', '_', 'g');
  v_slug := regexp_replace(v_slug, '^_+|_+$', '', 'g');
  if v_slug = '' then raise exception 'Enter a role name'; end if;

  select key into v_dept_key from public.departments where id = p_dept;
  v_key := coalesce(v_dept_key, 'dept') || '_' || v_slug;

  select coalesce(max(rank), 0) + 1 into v_rank
  from public.roles where department_id = p_dept;

  insert into public.roles (key, label, department_id, is_system, rank)
  values (v_key, trim(p_label), p_dept, false, v_rank)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_department_role(p_role uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_dept uuid;
begin
  select department_id into v_dept from public.roles
  where id = p_role and is_system = false;
  if v_dept is null then raise exception 'This role cannot be deleted'; end if;
  if not public.can_manage_department_roles(v_dept) then
    raise exception 'Not authorized to manage this department''s roles';
  end if;
  if exists (select 1 from public.project_members where role_id = p_role) then
    raise exception 'This role is assigned to project members. Reassign them first.';
  end if;
  delete from public.roles where id = p_role;  -- role_permissions cascade
end;
$$;

create or replace function public.set_department_role_permission(
  p_role uuid, p_resource text, p_action public.app_action, p_grant boolean
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

  if p_grant then
    insert into public.role_permissions (role_id, resource, action)
    values (p_role, p_resource, p_action) on conflict do nothing;
  else
    delete from public.role_permissions
    where role_id = p_role and resource = p_resource and action = p_action;
  end if;
end;
$$;

-- Reorder a role in its department's seniority ladder (up = more senior).
create or replace function public.move_department_role(p_role uuid, p_up boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_dept uuid; v_rank int; v_other uuid; v_other_rank int;
begin
  select department_id, rank into v_dept, v_rank from public.roles where id = p_role;
  if v_dept is null then raise exception 'Unknown role'; end if;
  if not public.can_manage_department_roles(v_dept) then
    raise exception 'Not authorized to manage this department''s roles';
  end if;

  if p_up then
    select id, rank into v_other, v_other_rank from public.roles
    where department_id = v_dept and rank < v_rank order by rank desc limit 1;
  else
    select id, rank into v_other, v_other_rank from public.roles
    where department_id = v_dept and rank > v_rank order by rank asc limit 1;
  end if;
  if v_other is null then return; end if;

  update public.roles set rank = v_other_rank where id = p_role;
  update public.roles set rank = v_rank where id = v_other;
end;
$$;
