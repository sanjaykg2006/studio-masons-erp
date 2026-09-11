-- Studio-Masons ERP — a pay-by date on petty cash.
-- Run AFTER 0080_every_project_role_everywhere.sql.
--
-- WHAT THIS ADDS
--   When logging a spend, the employee may set the date the payment should be
--   made by. The list shows it as the due date, and a claim still waiting for
--   approval or payment after that date shows how many days overdue it is. The
--   Finance department page summarises the same (open, overdue, due soon, by
--   stage). Optional: entries logged without one simply have no due date.
--
--   The list RPC now also returns paid_at, so "paid late" and "paid this month"
--   can be worked out without a second query.

alter table public.pettycash_entries add column if not exists due_date date;

do $$ begin
  alter table public.pettycash_entries
    add constraint pettycash_due_not_before_spend
    check (due_date is null or due_date >= spent_on);
exception when duplicate_object then null; end $$;

-- Logging a spend takes the optional pay-by date.
drop function if exists public.create_pettycash(uuid, uuid, text, numeric, text, date, text);
create function public.create_pettycash(
  p_project uuid, p_category uuid, p_kind text, p_amount numeric,
  p_description text, p_spent_on date, p_file text, p_due_date date default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in to log petty cash'; end if;
  if coalesce(p_amount, 0) <= 0 then raise exception 'Enter an amount'; end if;
  if p_due_date is not null and p_due_date < coalesce(p_spent_on, current_date) then
    raise exception 'The pay-by date cannot be before the date of the spend';
  end if;
  insert into public.pettycash_entries
    (project_id, category_id, kind, amount, description, spent_on, file_path, due_date)
  values (p_project, p_category,
          case when lower(coalesce(p_kind, '')) = 'float' then 'float' else 'reimbursement' end::public.pettycash_kind,
          p_amount, nullif(trim(p_description), ''), coalesce(p_spent_on, current_date),
          nullif(trim(p_file), ''), p_due_date)
  returning id into v_id;
  return v_id;
end;
$$;

grant execute on function public.create_pettycash(uuid, uuid, text, numeric, text, date, text, date) to authenticated;

-- The list returns the due date and when it was paid.
drop function if exists public.list_pettycash_entries();
create function public.list_pettycash_entries()
returns table (
  id uuid, created_by uuid, created_name text, project_id uuid, project_name text,
  category_name text, kind public.pettycash_kind, amount numeric, description text,
  spent_on date, file_path text, status public.pettycash_status,
  reject_reason text, created_at timestamptz, mine boolean,
  can_billing boolean, can_md boolean, can_pay boolean, can_reject boolean,
  due_date date, paid_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select e.id, e.created_by, coalesce(cp.full_name, cp.email), e.project_id, p.name,
         c.name, e.kind, e.amount, e.description, e.spent_on, e.file_path, e.status,
         e.reject_reason, e.created_at, e.created_by = auth.uid(),
         public.has_permission('pettycash.entry', 'approve'),
         public.has_permission('pettycash.entry', 'manage'),
         public.has_permission('pettycash.entry', 'issue'),
         (public.has_permission('pettycash.entry', 'approve')
          or public.has_permission('pettycash.entry', 'manage')
          or public.has_permission('pettycash.entry', 'issue')),
         e.due_date, e.paid_at
  from public.pettycash_entries e
  left join public.profiles cp on cp.id = e.created_by
  left join public.projects p on p.id = e.project_id
  left join public.pettycash_categories c on c.id = e.category_id
  where e.created_by = auth.uid()
     or public.has_permission('pettycash.entry', 'approve')
     or public.has_permission('pettycash.entry', 'issue')
     or public.has_permission('pettycash.entry', 'manage')
  order by e.created_at desc;
$$;

grant execute on function public.list_pettycash_entries() to authenticated;
