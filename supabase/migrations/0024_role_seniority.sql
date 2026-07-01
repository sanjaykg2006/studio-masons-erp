-- Studio-Masons ERP — Step 5 (part 1): seniority order for project roles
-- Run AFTER 0023_task_board.sql.
--
-- WHAT THIS ADDS
--   Project roles within a department get a hand-ordered SENIORITY rank
--   (rank 1 = most senior, top of the ladder). This ladder drives RFI escalation
--   (0025): an unanswered question climbs to the next-more-senior role.

-- 1. Rank column --------------------------------------------------------------
alter table public.roles add column if not exists rank int not null default 0;

-- Give each department's roles a starting order (system roles first). The user
-- reorders them on the settings screen afterwards.
with ordered as (
  select id,
         row_number() over (
           partition by department_id order by is_system desc, label
         ) as rn
  from public.roles
  where department_id is not null
)
update public.roles r
   set rank = o.rn
  from ordered o
 where o.id = r.id
   and r.rank = 0;

-- 2. Settings read now includes rank, ordered by it ---------------------------
-- Drop first: CREATE OR REPLACE can't change a function's return columns, and
-- we're adding `rank` to the returned table.
drop function if exists public.design_settings_roles();
create or replace function public.design_settings_roles()
returns table (id uuid, key text, label text, description text, is_system boolean, rank int)
language sql stable security definer set search_path = public
as $$
  select r.id, r.key, r.label, r.description, r.is_system, r.rank
  from public.roles r
  where r.department_id = public.design_department_id()
    and public.can_manage_design_roles()
  order by r.rank, r.label;
$$;

-- 3. Reorder one Design role up (more senior) or down -------------------------
-- Swaps rank with the adjacent role in the same department.
create or replace function public.move_design_role(p_role uuid, p_up boolean)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_dept  uuid;
  v_rank  int;
  v_other uuid;
  v_other_rank int;
begin
  if not public.can_manage_design_roles() then
    raise exception 'Not authorized to manage design roles';
  end if;

  select department_id, rank into v_dept, v_rank
  from public.roles where id = p_role;
  if v_dept is null then raise exception 'Unknown role'; end if;

  if p_up then
    -- the role just above (largest rank still smaller than mine)
    select id, rank into v_other, v_other_rank
    from public.roles
    where department_id = v_dept and rank < v_rank
    order by rank desc limit 1;
  else
    -- the role just below (smallest rank still larger than mine)
    select id, rank into v_other, v_other_rank
    from public.roles
    where department_id = v_dept and rank > v_rank
    order by rank asc limit 1;
  end if;

  if v_other is null then return; end if;  -- already at the end

  update public.roles set rank = v_other_rank where id = p_role;
  update public.roles set rank = v_rank       where id = v_other;
end;
$$;

-- 4. The seniority ladder of a department's roles (for RFI escalation, 0025) ---
-- Returns roles most-senior-first. SECURITY DEFINER so escalation can read it.
create or replace function public.department_role_ladder(p_dept uuid)
returns table (id uuid, label text, rank int)
language sql stable security definer set search_path = public
as $$
  select r.id, r.label, r.rank
  from public.roles r
  where r.department_id = p_dept
  order by r.rank;
$$;
