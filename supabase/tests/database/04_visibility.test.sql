-- Who sees what: project data stays on its project, back-office logs stay with
-- their tick, and nobody can change money or approval records by writing to the
-- tables directly (only through the checked functions).
begin;
\ir _helpers.psql
select plan(21);

-- ── Setup ────────────────────────────────────────────────────────────────────
create temp table t (k text primary key, v uuid);
grant all on t to authenticated, anon;
create function pg_temp.v(p text) returns uuid language sql stable as $$ select v from t where k = p $$;

insert into t values ('tower_a', tests.project('Tower A'));
insert into t values ('tower_b', tests.project('Tower B'));
update public.projects set phase = 'execution' where id in (pg_temp.v('tower_a'), pg_temp.v('tower_b'));
insert into t values ('vendor', tests.vendor());
insert into t values ('po_a', tests.issued_po(pg_temp.v('tower_a'), pg_temp.v('vendor'), 10, 100));
insert into t values ('po_b', tests.issued_po(pg_temp.v('tower_b'), pg_temp.v('vendor'), 10, 100));
insert into public.finance_invoices (project_id, order_id, vendor_id, invoice_no, vendor_invoice_no, vendor_invoice_date,
                                     base_value, amount_total, amount_payable)
select o.project_id, o.id, o.vendor_id, 'SM-INV-' || o.po_number, 'V-' || o.po_number, current_date, 100, 118, 118
from public.procurement_orders o where o.id in (pg_temp.v('po_a'), pg_temp.v('po_b'));

-- A site buyer on Tower A only (a project role, no job title), an accountant on
-- Tower A, an IT person, staff with nothing, and an approver.
insert into t values ('site_role', tests.role('T Site buyer', array['project:read', 'procurement.order:read']));
insert into t values ('acct_role', tests.role('T Site accounts', array['project:read', 'finance.invoice:read']));
select tests.person('buyer_a');
select tests.person('accounts_a');
select tests.person('it', tests.role('T IT', array['errorlog:read', 'audit:read']));
select tests.person('staff', tests.role('T Staff'));
select tests.person('colleague', tests.role('T Staff 2'));
insert into public.project_members (project_id, user_id, role_id) values
  (pg_temp.v('tower_a'), tests.uid('buyer_a'), pg_temp.v('site_role')),
  (pg_temp.v('tower_a'), tests.uid('accounts_a'), pg_temp.v('acct_role'));

insert into public.error_logs (source, context, message) values ('server', 'test', 'boom');
insert into public.audit_log (actor_id, action, summary) values (tests.uid('it'), 'test.action', 'Did a test thing');
select tests.login('staff');
select public.create_pettycash(null, null, 'reimbursement', 100, 'Mine', current_date, null);
select tests.login('colleague');
select public.create_pettycash(null, null, 'reimbursement', 200, 'Theirs', current_date, null);
select tests.logout();

-- Rows of a table the current user can see; refused outright counts as none.
create function pg_temp.visible(p_table text) returns int language plpgsql as $$
declare n int;
begin
  execute format('select count(*) from public.%I', p_table) into n;
  return n;
exception when insufficient_privilege then
  return 0;
end $$;

-- Runs a write as whoever is logged in and reports how many rows it changed.
create function pg_temp.rows_changed(p_sql text) returns int language plpgsql as $$
declare n int;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

-- ── Projects and their data stay on their project ────────────────────────────
select tests.login('buyer_a');
select is((select array_agg(name order by name) from public.projects), array['Tower A'],
          'a Tower A member sees Tower A and not Tower B');
select is((select array_agg(project_id) from public.procurement_orders), array[pg_temp.v('tower_a')],
          'and only Tower A''s purchase orders');
select is((select count(*)::int from public.finance_invoices), 0,
          'a buyer without the invoice tick sees no invoices, even on their project');
select tests.login('accounts_a');
select is((select array_agg(project_id) from public.finance_invoices), array[pg_temp.v('tower_a')],
          'Tower A''s accountant sees Tower A''s invoices only');
select tests.login('staff');
select is((select count(*)::int from public.projects), 0, 'someone on no project sees no projects');
select is((select count(*)::int from public.procurement_orders), 0, 'and no purchase orders');

-- ── Back-office records stay with their tick ─────────────────────────────────
select is((select count(*)::int from public.error_logs), 0, 'the Error Log is hidden without its tick');
select is((select count(*)::int from public.audit_log), 0, 'the Activity Log is hidden without its tick');
select is((select count(*)::int from public.approval_requests), 0, 'approval records are hidden without Access Control');
select is((select count(*)::int from public.profiles), 1, 'staff see only their own profile');
select is((select array_agg(description) from public.pettycash_entries), array['Mine'],
          'staff see their own petty cash claims, not a colleague''s');
select tests.login('it');
select ok((select count(*) from public.error_logs) > 0 and (select count(*) from public.audit_log) > 0,
          'IT, with the ticks, sees both logs');
select is((select count(*)::int from public.alert_state), 0, 'alert bookkeeping is hidden from everyone');

-- ── Nobody signed in sees anything ───────────────────────────────────────────
select tests.logout();
select set_config('role', 'anon', true);
select is(pg_temp.visible('projects') + pg_temp.visible('procurement_orders')
          + pg_temp.visible('profiles') + pg_temp.visible('finance_invoices'), 0,
          'the public (not signed in) sees no projects, POs, people or invoices');
select tests.logout();

-- ── Money and approvals can't be changed by writing to the tables ────────────
select tests.login('buyer_a');
select is(pg_temp.rows_changed(format($$update public.procurement_orders set status = 'cancelled' where id = %L$$, pg_temp.v('po_a'))),
          0, 'a buyer cannot change a PO''s status by writing to the table');
select tests.login('accounts_a');
select is(pg_temp.rows_changed($$update public.finance_invoices set status = 'approved', amount_payable = 1000000$$),
          0, 'an accountant cannot approve or inflate an invoice by writing to the table');
select throws_like(
  format($$insert into public.approval_decisions (request_id, stage_index, stage_label, decided_by, decision)
           values (%L, 0, 'Stage 1', %L, 'approved')$$,
         (select id from public.approval_requests where flow_id = 'invoice' limit 1), tests.uid('accounts_a')),
  '%row-level security%', 'nobody can forge an approval decision');
select tests.login('staff');
select is(pg_temp.rows_changed($$update public.pettycash_entries set status = 'paid', amount = 99999$$),
          0, 'nobody can mark their own claim paid or change its amount directly');
select is(pg_temp.rows_changed($$update public.profiles set full_name = 'Staff Member' where id = auth.uid()$$),
          1, 'staff can still edit their own name…');
select tests.logout();
select tests.login('staff');
select throws_ok(
  format($$update public.profiles set role_id = %L where id = auth.uid()$$, (select role_id from public.profiles where id = tests.uid('it'))),
  'Not authorized to change role', '…but cannot give themselves another job title');
select throws_ok($$update public.profiles set role_id = null where id = auth.uid()$$,
  'Not authorized to change role', '…or take their own job title away');
select tests.logout();

select * from finish();
rollback;
