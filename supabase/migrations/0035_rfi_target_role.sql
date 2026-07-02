-- Studio-Masons ERP — raise an RFI to a specific role (not just the most junior)
-- Run AFTER 0034_rfi_attachments.sql.
--
-- WHAT THIS ADDS
--   When raising a question you can now aim it at a chosen role on the target
--   department's ladder instead of always starting at the most junior one.
--   Escalation is unchanged: it still climbs one rung up from wherever the
--   question currently sits, so a question raised straight to (say) Project
--   Manager escalates on to PM Lead from there.
--
--   Leaving the role unset keeps the old behaviour: it starts at the bottom
--   (most junior) rung.

-- 1. raise_rfi gains an optional target role ----------------------------------
-- DROP first: we're changing the argument signature (adding a parameter), which
-- CREATE OR REPLACE can't do — it would leave a second overload behind.
drop function if exists public.raise_rfi(uuid, uuid, text, text);
create or replace function public.raise_rfi(
  p_project uuid,
  p_to_dept uuid,
  p_subject text,
  p_body    text,
  p_to_role uuid default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_from uuid;
  v_start uuid;
  v_id uuid;
begin
  if not public.can_view_project(p_project) then
    raise exception 'Not authorized on this project';
  end if;
  if coalesce(trim(p_subject), '') = '' then
    raise exception 'Enter a subject';
  end if;
  if p_to_dept is null then raise exception 'Pick a department to ask'; end if;

  -- The caller's department on this project (best effort, for the "from" label).
  select r.department_id into v_from
  from public.project_members m
  join public.roles r on r.id = m.role_id
  where m.project_id = p_project and m.user_id = auth.uid()
  limit 1;
  if v_from is null then
    select tm.department_id into v_from
    from public.team_members tm where tm.user_id = auth.uid() limit 1;
  end if;

  -- Where on the ladder the question starts.
  if p_to_role is not null then
    -- A chosen role — it must belong to the target department.
    select id into v_start
    from public.roles
    where id = p_to_role and department_id = p_to_dept;
    if v_start is null then
      raise exception 'That role is not in the chosen department';
    end if;
  else
    -- Default: the bottom of the ladder (most junior = highest rank number).
    select id into v_start
    from public.roles
    where department_id = p_to_dept
    order by rank desc limit 1;
  end if;

  insert into public.rfis (project_id, from_department_id, to_department_id, subject, current_role_id)
  values (p_project, v_from, p_to_dept, trim(p_subject), v_start)
  returning id into v_id;

  if coalesce(trim(p_body), '') <> '' then
    insert into public.rfi_messages (rfi_id, body) values (v_id, trim(p_body));
  end if;
  return v_id;
end;
$$;

-- 2. The role ladder of every department, for the "send to" picker ------------
-- Returns each department's roles most-senior-first. SECURITY DEFINER so the
-- raiser can read the target department's roles even without direct access.
create or replace function public.list_department_roles()
returns table (department_id uuid, id uuid, label text, rank int)
language sql stable security definer set search_path = public
as $$
  select r.department_id, r.id, r.label, r.rank
  from public.roles r
  where r.department_id is not null
  order by r.department_id, r.rank;
$$;
