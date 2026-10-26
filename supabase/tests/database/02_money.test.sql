-- Money: vendor invoices, payment requests, PO advances, retention, petty cash.
begin;
\ir _helpers.psql
select plan(33);

-- ── Setup ────────────────────────────────────────────────────────────────────
select tests.person('accounts', tests.role('T Accounts', array[
  'finance.invoice:read', 'finance.invoice:create', 'finance.payment:create', 'finance.payment:issue',
  'finance.advance:update', 'finance.advance:issue', 'finance.retention:issue', 'pettycash.pay:issue']));
select tests.person('director', tests.role('T Director', array['finance.invoice:read']));
select tests.person('md', tests.role('T MD', array['finance.invoice:manage']));
select tests.person('pm', tests.role('T PM', array['finance.retention:update']));
select tests.person('cofounder', tests.role('T Co-Founder'));
select tests.person('billing', tests.role('T Billing'));
select tests.person('senior', tests.role('T Senior'));
select tests.person('staff', tests.role('T Staff'));

create function pg_temp.role_of(p_key text) returns uuid language sql stable as $$
  select role_id from public.profiles where id = tests.uid(p_key) $$;
select tests.stages('invoice', array[pg_temp.role_of('director')]);
select tests.stages('payment', array[pg_temp.role_of('director')]);
select tests.stages('advance', array[pg_temp.role_of('director')]);
select tests.stages('retention_early', array[pg_temp.role_of('cofounder')]);
select tests.stages('pettycash', array[pg_temp.role_of('billing'), pg_temp.role_of('senior')]);

create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql stable as $$ select v from t where k = p $$;
insert into t values ('project', tests.project('Tower B'));
insert into t values ('vendor', tests.vendor());
-- PO worth 10 × 100 = ₹1,000.
insert into t values ('po', tests.issued_po(pg_temp.v('project'), pg_temp.v('vendor'), 10, 100));

create function pg_temp.invoice_sql(p_order uuid, p_no text, p_base numeric) returns text language sql as $$
  select format($f$select public.create_invoice(%L, %L, current_date, null,
                  jsonb_build_array(jsonb_build_object('base', %s)), 'inv.pdf', null)$f$, p_order, p_no, p_base) $$;

-- ── Vendor invoices ──────────────────────────────────────────────────────────
update public.procurement_orders set acceptance_file = null where id = pg_temp.v('po');
select tests.login('accounts');
select throws_ok(pg_temp.invoice_sql(pg_temp.v('po'), 'V-1', 500),
  'Upload the vendor''s acceptance letter on the purchase order before invoicing',
  'no invoice without the vendor''s acceptance letter');
select tests.logout();
update public.procurement_orders set acceptance_file = 'test/acceptance.pdf' where id = pg_temp.v('po');

update public.procurement_orders set status = 'draft' where id = pg_temp.v('po');
select tests.login('accounts');
select throws_ok(pg_temp.invoice_sql(pg_temp.v('po'), 'V-1', 500),
  'Invoices can only be raised against a released purchase order',
  'no invoice against an unreleased PO');
select tests.logout();
update public.procurement_orders set status = 'issued' where id = pg_temp.v('po');

select tests.login('staff');
select throws_ok(pg_temp.invoice_sql(pg_temp.v('po'), 'V-1', 500),
  'Not authorized to enter invoices on this project', 'only Accounts can enter invoices');

select tests.login('accounts');
select lives_ok(pg_temp.invoice_sql(pg_temp.v('po'), 'V-1', 500), 'an invoice within the PO value is entered');
select throws_ok(pg_temp.invoice_sql(pg_temp.v('po'), 'v-1', 100),
  'An invoice with number "v-1" already exists for this vendor',
  'the same vendor invoice number cannot be entered twice');
-- A second bill takes the PO to ₹1,200 invoiced against ₹1,000 ordered.
select lives_ok(pg_temp.invoice_sql(pg_temp.v('po'), 'V-2', 700), 'an over-cap invoice can still be entered (flagged)');
select tests.logout();
insert into t select 'inv1', id from public.finance_invoices where vendor_invoice_no = 'V-1';
insert into t select 'inv2', id from public.finance_invoices where vendor_invoice_no = 'V-2';
select ok(public.invoice_over_cap(pg_temp.v('inv2')), 'invoicing past the PO value is flagged over the cap');

select tests.login('accounts');
select throws_ok(format('select public.approval_decide(%L, true, null)', tests.request('invoice', pg_temp.v('inv1'))),
  'You can''t approve or reject your own request', 'Accounts cannot approve the invoice they entered');
select tests.login('director');
select throws_ok(format('select public.approval_decide(%L, true, null)', tests.request('invoice', pg_temp.v('inv2'))),
  'This invoice is over the PO cap — a Director/MD must override it before approval',
  'an over-cap invoice cannot be approved until someone overrides the cap');
select throws_ok(format('select public.bypass_invoice_cap(%L)', pg_temp.v('inv2')),
  'Not authorized to override the PO cap', 'the cap override needs its own tick');
select tests.login('md');
select lives_ok(format('select public.bypass_invoice_cap(%L)', pg_temp.v('inv2')), 'the MD overrides the cap');
select tests.login('director');
select is(public.approval_decide(tests.request('invoice', pg_temp.v('inv2')), true, null), 'approved',
          'after the override the Director can approve it');
select tests.logout();
select is((select status::text from public.finance_invoices where id = pg_temp.v('inv2')), 'pending_accounts',
          'an approved invoice goes to Accounts to book');

-- ── Payment requests ─────────────────────────────────────────────────────────
select tests.login('accounts');
select throws_ok(format($$select public.raise_payment_request(%L, 100, 'high', null)$$, pg_temp.v('inv1')),
  'Only an approved invoice can be paid', 'no payment against an invoice that isn''t approved');
select tests.logout();
update public.finance_invoices set status = 'approved', amount_payable = 500, requested_amount = 0
 where id = pg_temp.v('inv1');

select tests.login('accounts');
select throws_like(format($$select public.raise_payment_request(%L, 600, 'high', null)$$, pg_temp.v('inv1')),
  'That is more than the % remaining on this invoice', 'a payment cannot exceed what is left on the invoice');
insert into t values ('pay1', public.raise_payment_request(pg_temp.v('inv1'), 300, 'high', null));
select throws_like(format($$select public.raise_payment_request(%L, 300, 'high', null)$$, pg_temp.v('inv1')),
  'That is more than the % remaining on this invoice', 'requests already raised count against the invoice');
select throws_ok(format('select public.mark_payment_paid(%L)', pg_temp.v('pay1')),
  'The request must be approved before it is paid', 'a payment cannot be paid before it is approved');
select tests.logout();

select tests.approve('payment', pg_temp.v('pay1'), array['director']);
select tests.login('staff');
select throws_ok(format('select public.mark_payment_paid(%L)', pg_temp.v('pay1')),
  'Not authorized to mark payments paid (Accounts)', 'only Accounts can mark a payment paid');
select tests.login('accounts');
select lives_ok(format('select public.mark_payment_paid(%L)', pg_temp.v('pay1')), 'Accounts pays an approved request');

insert into t values ('pay2', public.raise_payment_request(pg_temp.v('inv1'), 200, 'low', null));
select tests.login('director');
select is(public.approval_decide(tests.request('payment', pg_temp.v('pay2')), false, 'Not this month'), 'rejected',
          'the Director turns a payment request down');
select tests.logout();
select is((select requested_amount from public.finance_invoices where id = pg_temp.v('inv1')), 300::numeric,
          'a turned-down request frees its amount on the invoice again');

-- ── PO advances ──────────────────────────────────────────────────────────────
select tests.login('staff');
select throws_ok(format('select public.request_po_advance(%L, 500, 5)', pg_temp.v('po')),
  'Not authorized to request an advance', 'only the advance tick can ask for one');
select tests.login('accounts');
select public.request_po_advance(pg_temp.v('po'), 500, 5);
select throws_ok(format('select public.pay_po_advance(%L)', pg_temp.v('po')),
  'The advance must be approved first', 'an advance cannot be paid before approval');
select tests.logout();
select tests.approve('advance', pg_temp.v('po'), array['director']);
select is((select advance_payable from public.procurement_orders where id = pg_temp.v('po')), 475::numeric,
          'the approved advance is paid net of 5% TDS');
select tests.login('accounts');
select lives_ok(format('select public.pay_po_advance(%L)', pg_temp.v('po')), 'Accounts pays the approved advance');
select tests.logout();

-- ── Retention ────────────────────────────────────────────────────────────────
insert into public.finance_retention (project_id, invoice_id, amount, due_date)
values (pg_temp.v('project'), pg_temp.v('inv1'), 50, current_date + 180);
insert into t select 'ret', id from public.finance_retention where invoice_id = pg_temp.v('inv1');
select tests.login('accounts');
select throws_like(format('select public.mark_retention_paid(%L)', pg_temp.v('ret')),
  'This retention is not due until %', 'retention cannot be paid before its due date');
select tests.login('pm');
select public.request_early_retention(pg_temp.v('ret'));
select tests.login('accounts');
select throws_like(format('select public.mark_retention_paid(%L)', pg_temp.v('ret')),
  'This retention is not due until %', 'asking for an early release is not enough on its own');
select tests.logout();
select tests.approve('retention_early', pg_temp.v('ret'), array['cofounder']);
select tests.login('accounts');
select lives_ok(format('select public.mark_retention_paid(%L)', pg_temp.v('ret')),
  'once the Co-Founder approves the early release, Accounts can pay it');
select tests.logout();

-- ── Petty cash ───────────────────────────────────────────────────────────────
select tests.login('staff');
insert into t values ('claim', public.create_pettycash(null, null, 'reimbursement', 250, 'Taxi', current_date, null));
select throws_ok(format('select public.approval_decide(%L, true, null)', tests.request('pettycash', pg_temp.v('claim'))),
  'You can''t approve or reject your own request', 'nobody approves their own claim');
select tests.login('accounts');
select throws_ok(format('select public.pay_pettycash(%L)', pg_temp.v('claim')),
  'This claim is not waiting for payment', 'a claim cannot be paid before it is approved');
select tests.logout();
select tests.approve('pettycash', pg_temp.v('claim'), array['billing', 'senior']);
select tests.login('staff');
select throws_ok(format('select public.pay_pettycash(%L)', pg_temp.v('claim')),
  'You can''t pay or reject your own claim', 'nobody pays their own claim');
select tests.login('senior');
select throws_ok(format('select public.pay_pettycash(%L)', pg_temp.v('claim')),
  'This claim is waiting for payment — only Accounts can act on it', 'only Accounts pays claims');
select tests.login('accounts');
select lives_ok(format('select public.pay_pettycash(%L)', pg_temp.v('claim')), 'Accounts pays an approved claim');
select tests.logout();

select * from finish();
rollback;
