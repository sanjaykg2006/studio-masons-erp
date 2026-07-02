-- Studio-Masons ERP — Procurement slice 4: comparison + per-project vendor list
-- Run AFTER 0038_procurement_intents.sql.
--
-- WHAT THIS ADDS  (see docs/procurement-module-plan.md §2a, §3)
--   A COMPARISON weighs vendor quotes for a package of budget lines. The
--   Procurement Manager seeds a comparison from a released budget package (its
--   lines copy in), adds the vendors being compared, and enters each vendor's rate
--   per line. The Director AWARDS each line to a vendor (same vendor on every line
--   = a whole-package award; different vendors = a split). Awarding records the
--   winners and adds them to the project's APPROVED-VENDOR list.
--
--   procurement_vendor_project_approvals is that per-project list — the union of
--   comparison winners and explicit manual approvals; managed by whoever can award
--   (procurement.comparison:approve).
--
--   Writes go through SECURITY DEFINER RPCs; RLS carries read policies only.
--   Excel import of a comparison workbook is a follow-up.

-- 1. Register the resource ----------------------------------------------------
insert into public.department_modules (department_id, module_id)
select d.id, 'procurement.comparison'
from public.departments d
where d.key = 'procurement'
on conflict do nothing;

insert into public.module_settings (module_id, is_general)
values ('procurement.comparison', false)
on conflict (module_id) do nothing;

-- 2. Vocabulary + tables ------------------------------------------------------
do $$ begin
  create type public.procurement_comparison_status as enum ('draft', 'awarded');
exception when duplicate_object then null; end $$;

create table if not exists public.procurement_comparisons (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects (id) on delete cascade,
  package_id    uuid references public.procurement_budget_packages (id),
  title         text,
  status        public.procurement_comparison_status not null default 'draft',
  prepared_by   uuid references public.profiles (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  awarded_by    uuid references public.profiles (id),
  awarded_at    timestamptz
);
create index if not exists procurement_comparisons_project_idx on public.procurement_comparisons (project_id);

-- The vendors being compared (stable columns for the grid).
create table if not exists public.procurement_comparison_vendors (
  comparison_id uuid not null references public.procurement_comparisons (id) on delete cascade,
  vendor_id     uuid not null references public.procurement_vendors (id) on delete cascade,
  primary key (comparison_id, vendor_id)
);

create table if not exists public.procurement_comparison_lines (
  id             uuid primary key default gen_random_uuid(),
  comparison_id  uuid not null references public.procurement_comparisons (id) on delete cascade,
  budget_line_id uuid references public.procurement_budget_lines (id),
  description    text not null,
  unit           text,
  qty            numeric not null default 0,
  sort           int not null default 0
);
create index if not exists procurement_comparison_lines_cmp_idx on public.procurement_comparison_lines (comparison_id);

create table if not exists public.procurement_comparison_quotes (
  id                 uuid primary key default gen_random_uuid(),
  comparison_line_id uuid not null references public.procurement_comparison_lines (id) on delete cascade,
  vendor_id          uuid not null references public.procurement_vendors (id) on delete cascade,
  rate               numeric not null default 0,
  make               text,
  unique (comparison_line_id, vendor_id)
);

create table if not exists public.procurement_comparison_awards (
  comparison_line_id uuid primary key references public.procurement_comparison_lines (id) on delete cascade,
  vendor_id          uuid not null references public.procurement_vendors (id),
  qty                numeric not null default 0,
  rate               numeric not null default 0
);

-- The per-project approved-vendor list.
create table if not exists public.procurement_vendor_project_approvals (
  project_id  uuid not null references public.projects (id) on delete cascade,
  vendor_id   uuid not null references public.procurement_vendors (id) on delete cascade,
  approved_by uuid references public.profiles (id),
  approved_at timestamptz not null default now(),
  primary key (project_id, vendor_id)
);

-- 3. Helpers ------------------------------------------------------------------
create or replace function public.procurement_comparison_project(p_comparison uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select project_id from public.procurement_comparisons where id = p_comparison;
$$;

create or replace function public.can_comparison(p_comparison uuid, p_action public.app_action)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_project_permission(
    public.procurement_comparison_project(p_comparison), 'procurement.comparison', p_action);
$$;

-- The comparison a line belongs to.
create or replace function public.procurement_comparison_line_cmp(p_line uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select comparison_id from public.procurement_comparison_lines where id = p_line;
$$;

-- 4. RLS (reads; writes go through RPCs) --------------------------------------
alter table public.procurement_comparisons               enable row level security;
alter table public.procurement_comparison_vendors        enable row level security;
alter table public.procurement_comparison_lines          enable row level security;
alter table public.procurement_comparison_quotes         enable row level security;
alter table public.procurement_comparison_awards         enable row level security;
alter table public.procurement_vendor_project_approvals  enable row level security;

drop policy if exists "procurement_comparisons_select" on public.procurement_comparisons;
create policy "procurement_comparisons_select" on public.procurement_comparisons
  for select using (public.has_project_permission(project_id, 'procurement.comparison', 'read'));

drop policy if exists "procurement_comparison_vendors_select" on public.procurement_comparison_vendors;
create policy "procurement_comparison_vendors_select" on public.procurement_comparison_vendors
  for select using (public.can_comparison(comparison_id, 'read'));

drop policy if exists "procurement_comparison_lines_select" on public.procurement_comparison_lines;
create policy "procurement_comparison_lines_select" on public.procurement_comparison_lines
  for select using (public.can_comparison(comparison_id, 'read'));

drop policy if exists "procurement_comparison_quotes_select" on public.procurement_comparison_quotes;
create policy "procurement_comparison_quotes_select" on public.procurement_comparison_quotes
  for select using (public.can_comparison(public.procurement_comparison_line_cmp(comparison_line_id), 'read'));

drop policy if exists "procurement_comparison_awards_select" on public.procurement_comparison_awards;
create policy "procurement_comparison_awards_select" on public.procurement_comparison_awards
  for select using (public.can_comparison(public.procurement_comparison_line_cmp(comparison_line_id), 'read'));

drop policy if exists "procurement_vendor_project_approvals_select" on public.procurement_vendor_project_approvals;
create policy "procurement_vendor_project_approvals_select" on public.procurement_vendor_project_approvals
  for select using (public.has_project_permission(project_id, 'procurement.comparison', 'read'));

-- 5. Write RPCs ---------------------------------------------------------------

-- Start a comparison from a released budget package; its lines copy in.
create or replace function public.create_comparison(
  p_project uuid, p_package uuid, p_title text
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  if not public.has_project_permission(p_project, 'procurement.comparison', 'create') then
    raise exception 'Not authorized to prepare a comparison on this project';
  end if;
  -- The package must be on this project.
  if not exists (
    select 1 from public.procurement_budget_packages pk
    join public.procurement_budgets b on b.id = pk.budget_id
    where pk.id = p_package and b.project_id = p_project
  ) then
    raise exception 'That package is not on this project';
  end if;

  insert into public.procurement_comparisons (project_id, package_id, title)
  values (p_project, p_package, nullif(trim(p_title), ''))
  returning id into v_id;

  insert into public.procurement_comparison_lines
    (comparison_id, budget_line_id, description, unit, qty, sort)
  select v_id, bl.id, bl.description, bl.unit, bl.qty, bl.sort
  from public.procurement_budget_lines bl
  where bl.package_id = p_package;

  return v_id;
end;
$$;

-- Add / remove a vendor column (draft only).
create or replace function public.add_comparison_vendor(p_comparison uuid, p_vendor uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_comparison(p_comparison, 'create') then
    raise exception 'Not authorized to edit this comparison';
  end if;
  if (select status from public.procurement_comparisons where id = p_comparison) <> 'draft' then
    raise exception 'This comparison is awarded and locked';
  end if;
  insert into public.procurement_comparison_vendors (comparison_id, vendor_id)
  values (p_comparison, p_vendor) on conflict do nothing;
end;
$$;

create or replace function public.remove_comparison_vendor(p_comparison uuid, p_vendor uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.can_comparison(p_comparison, 'create') then
    raise exception 'Not authorized to edit this comparison';
  end if;
  if (select status from public.procurement_comparisons where id = p_comparison) <> 'draft' then
    raise exception 'This comparison is awarded and locked';
  end if;
  delete from public.procurement_comparison_vendors
   where comparison_id = p_comparison and vendor_id = p_vendor;
  -- Drop that vendor's quotes on this comparison too.
  delete from public.procurement_comparison_quotes q
   using public.procurement_comparison_lines l
   where q.comparison_line_id = l.id and l.comparison_id = p_comparison and q.vendor_id = p_vendor;
end;
$$;

-- Enter (or clear) one vendor's rate on one line. Null rate clears the quote.
create or replace function public.set_quote(
  p_line uuid, p_vendor uuid, p_rate numeric, p_make text
)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_cmp uuid;
begin
  v_cmp := public.procurement_comparison_line_cmp(p_line);
  if not public.can_comparison(v_cmp, 'create') then
    raise exception 'Not authorized to edit this comparison';
  end if;
  if (select status from public.procurement_comparisons where id = v_cmp) <> 'draft' then
    raise exception 'This comparison is awarded and locked';
  end if;

  if p_rate is null then
    delete from public.procurement_comparison_quotes
     where comparison_line_id = p_line and vendor_id = p_vendor;
  else
    insert into public.procurement_comparison_quotes (comparison_line_id, vendor_id, rate, make)
    values (p_line, p_vendor, p_rate, nullif(trim(p_make), ''))
    on conflict (comparison_line_id, vendor_id)
      do update set rate = excluded.rate, make = excluded.make;
  end if;
end;
$$;

-- Award: p_awards is [{ "line_id": "...", "vendor_id": "..." }, ...]. Each named
-- vendor must have a quote on that line. Locks the comparison and adds the
-- winners to the project's approved-vendor list.
create or replace function public.award_comparison(p_comparison uuid, p_awards jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_project uuid; v_status public.procurement_comparison_status;
  a jsonb; v_line uuid; v_vendor uuid; v_rate numeric; v_qty numeric;
begin
  select project_id, status into v_project, v_status
  from public.procurement_comparisons where id = p_comparison;
  if v_project is null then raise exception 'Comparison not found'; end if;
  if not public.has_project_permission(v_project, 'procurement.comparison', 'approve') then
    raise exception 'Not authorized to award on this project';
  end if;
  if v_status <> 'draft' then raise exception 'This comparison is already awarded'; end if;
  if p_awards is null or jsonb_array_length(p_awards) = 0 then
    raise exception 'Pick a winning vendor for at least one line';
  end if;

  for a in select value from jsonb_array_elements(p_awards) loop
    v_line   := (a->>'line_id')::uuid;
    v_vendor := (a->>'vendor_id')::uuid;

    -- The line belongs to this comparison; the vendor has a quote on it.
    select l.qty, q.rate into v_qty, v_rate
    from public.procurement_comparison_lines l
    join public.procurement_comparison_quotes q
      on q.comparison_line_id = l.id and q.vendor_id = v_vendor
    where l.id = v_line and l.comparison_id = p_comparison;
    if v_rate is null then
      raise exception 'A chosen vendor has no quote on one of the lines';
    end if;

    insert into public.procurement_comparison_awards (comparison_line_id, vendor_id, qty, rate)
    values (v_line, v_vendor, v_qty, v_rate)
    on conflict (comparison_line_id)
      do update set vendor_id = excluded.vendor_id, qty = excluded.qty, rate = excluded.rate;

    -- Winner becomes an approved vendor for the project.
    insert into public.procurement_vendor_project_approvals (project_id, vendor_id, approved_by)
    values (v_project, v_vendor, auth.uid())
    on conflict (project_id, vendor_id) do nothing;
  end loop;

  update public.procurement_comparisons
     set status = 'awarded', awarded_by = auth.uid(), awarded_at = now()
   where id = p_comparison;
end;
$$;

-- Manually approve / remove a vendor for a project (approve verb).
create or replace function public.set_project_vendor(
  p_project uuid, p_vendor uuid, p_approved boolean
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.has_project_permission(p_project, 'procurement.comparison', 'approve') then
    raise exception 'Not authorized to manage this project''s vendors';
  end if;
  if p_approved then
    insert into public.procurement_vendor_project_approvals (project_id, vendor_id, approved_by)
    values (p_project, p_vendor, auth.uid()) on conflict (project_id, vendor_id) do nothing;
  else
    delete from public.procurement_vendor_project_approvals
     where project_id = p_project and vendor_id = p_vendor;
  end if;
end;
$$;

-- 6. Read RPCs ----------------------------------------------------------------
create or replace function public.list_project_comparisons(p_project uuid)
returns table (
  id uuid, title text, package_id uuid, package_name text,
  status public.procurement_comparison_status,
  prepared_by uuid, prepared_by_name text, created_at timestamptz,
  awarded_by uuid, awarded_by_name text, awarded_at timestamptz,
  line_count bigint, vendor_count bigint,
  can_edit boolean, can_award boolean
)
language sql stable security definer set search_path = public
as $$
  select c.id, c.title, c.package_id, pk.name, c.status,
         c.prepared_by, coalesce(pp.full_name, pp.email), c.created_at,
         c.awarded_by, coalesce(ap.full_name, ap.email), c.awarded_at,
         (select count(*) from public.procurement_comparison_lines l where l.comparison_id = c.id),
         (select count(*) from public.procurement_comparison_vendors v where v.comparison_id = c.id),
         public.has_project_permission(c.project_id, 'procurement.comparison', 'create'),
         public.has_project_permission(c.project_id, 'procurement.comparison', 'approve')
  from public.procurement_comparisons c
  left join public.procurement_budget_packages pk on pk.id = c.package_id
  left join public.profiles pp on pp.id = c.prepared_by
  left join public.profiles ap on ap.id = c.awarded_by
  where c.project_id = p_project
    and public.has_project_permission(p_project, 'procurement.comparison', 'read')
  order by case c.status when 'draft' then 0 else 1 end, c.created_at desc;
$$;

-- The project's approved-vendor list.
create or replace function public.list_project_vendors(p_project uuid)
returns table (vendor_id uuid, name text, type public.procurement_vendor_type,
               approved_by uuid, approved_by_name text, approved_at timestamptz)
language sql stable security definer set search_path = public
as $$
  select a.vendor_id, v.name, v.type,
         a.approved_by, coalesce(p.full_name, p.email), a.approved_at
  from public.procurement_vendor_project_approvals a
  join public.procurement_vendors v on v.id = a.vendor_id
  left join public.profiles p on p.id = a.approved_by
  where a.project_id = p_project
    and public.has_project_permission(p_project, 'procurement.comparison', 'read')
  order by v.name;
$$;

-- 7. Seed grants --------------------------------------------------------------
-- Procurement Manager + team prepare comparisons; Director's `approve` (award) is
-- a company-wide grant assigned via /access.
insert into public.role_permissions (role_id, resource, action)
select r.id, 'procurement.comparison', x.action::public.app_action
from public.roles r
cross join (values ('read'), ('create')) as x(action)
where r.key in ('procurement_manager', 'procurement_member')
on conflict do nothing;
