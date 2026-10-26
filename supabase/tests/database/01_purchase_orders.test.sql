-- Purchase orders: generating, approving, releasing, receiving and cancelling.
begin;
\ir _helpers.psql
select plan(27);

-- ── Setup ────────────────────────────────────────────────────────────────────
select tests.person('buyer', tests.role('T Buyer', array[
  'procurement.order:read', 'procurement.order:issue', 'procurement.order:update',
  'procurement.receipt:read', 'procurement.receipt:create']));
select tests.person('finance', tests.role('T Finance', array['procurement.order:read']));
select tests.person('director', tests.role('T Director', array[
  'procurement.order:read', 'procurement.order:approve']));
select tests.person('outsider', tests.role('T Outsider'));
select tests.stages('order', array[
  (select role_id from public.profiles where id = tests.uid('finance')),
  (select role_id from public.profiles where id = tests.uid('director'))]);

create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
insert into t values ('project', tests.project('Tower A'));
insert into t values ('line', tests.budget_line((select v from t where k = 'project'), 100));
insert into t values ('il', tests.intent_line((select v from t where k = 'project'), (select v from t where k = 'line'), 10));
insert into t values ('vendor', tests.vendor());
insert into t values ('sleepy', tests.vendor('Sleepy Traders', false));
create function pg_temp.v(p text) returns uuid language sql stable as $$ select v from t where k = p $$;

-- ── Generating a PO ──────────────────────────────────────────────────────────
select tests.login('outsider');
select throws_ok(
  format($$select public.create_orders_from_intent(%L,
    jsonb_build_array(jsonb_build_object('intent_line_id', %L::uuid, 'vendor_id', %L::uuid, 'rate', 90)),
    jsonb_build_array(jsonb_build_object('vendor_id', %L::uuid, 'support_file', 'x.pdf')))$$,
    tests.intent_of(pg_temp.v('il')), pg_temp.v('il'), pg_temp.v('vendor'), pg_temp.v('vendor')),
  'Not authorized to raise purchase orders on this project',
  'someone without the PO tick cannot generate a PO');

select tests.login('buyer');
select throws_ok(
  format($$select public.create_orders_from_intent(%L,
    jsonb_build_array(jsonb_build_object('intent_line_id', %L::uuid, 'vendor_id', %L::uuid, 'rate', 90)),
    jsonb_build_array(jsonb_build_object('vendor_id', %L::uuid, 'support_file', 'x.pdf')))$$,
    tests.intent_of(pg_temp.v('il')), pg_temp.v('il'), pg_temp.v('sleepy'), pg_temp.v('sleepy')),
  'This vendor is inactive — switch it back on in the vendor directory first',
  'an inactive vendor cannot get a new PO');

select throws_ok(
  format($$select public.create_orders_from_intent(%L,
    jsonb_build_array(jsonb_build_object('intent_line_id', %L::uuid, 'vendor_id', %L::uuid, 'rate', 90)),
    '[]'::jsonb)$$,
    tests.intent_of(pg_temp.v('il')), pg_temp.v('il'), pg_temp.v('vendor')),
  'Attach a supporting document for every vendor before generating',
  'a PO needs the vendor''s supporting document');
select tests.logout();

-- An intent still waiting for approval can't be ordered against.
update public.procurement_intents set status = 'pending' where id = tests.intent_of(pg_temp.v('il'));
select tests.login('buyer');
select throws_ok(
  format($$select public.create_orders_from_intent(%L,
    jsonb_build_array(jsonb_build_object('intent_line_id', %L::uuid, 'vendor_id', %L::uuid, 'rate', 90)),
    jsonb_build_array(jsonb_build_object('vendor_id', %L::uuid, 'support_file', 'x.pdf')))$$,
    tests.intent_of(pg_temp.v('il')), pg_temp.v('il'), pg_temp.v('vendor'), pg_temp.v('vendor')),
  'The intent must be approved first',
  'an unapproved intent cannot be ordered');
select tests.logout();
update public.procurement_intents set status = 'approved' where id = tests.intent_of(pg_temp.v('il'));

insert into t values ('po', tests.draft_po('buyer', pg_temp.v('il'), pg_temp.v('vendor')));
select is((select qty_ordered from public.procurement_order_lines where order_id = pg_temp.v('po')),
          10::numeric, 'the PO orders the intent''s open quantity');
select is((select status::text from public.approval_requests where flow_id = 'order' and item_id = pg_temp.v('po')),
          'pending', 'a new PO goes into its approval stages');

-- ── Approving ────────────────────────────────────────────────────────────────
select tests.login('buyer');
select throws_ok(format('select public.release_order(%L)', pg_temp.v('po')),
  'This PO is still going through its approval stages',
  'a PO cannot be released before it is approved');
select throws_ok(format('select public.approval_decide(%L, true, null)', tests.request('order', pg_temp.v('po'))),
  'You can''t approve or reject your own request',
  'whoever raised the PO cannot approve it');

select tests.login('director');
select throws_like(format('select public.approval_decide(%L, true, null)', tests.request('order', pg_temp.v('po'))),
  'This is waiting for "Stage 1"%',
  'the Director cannot give the Finance stage');

select tests.login('finance');
select is(public.approval_decide(tests.request('order', pg_temp.v('po')), true, null),
          'pending', 'Finance approves the first stage; the PO moves to the second');
select throws_like(format('select public.approval_decide(%L, true, null)', tests.request('order', pg_temp.v('po'))),
  'You already gave an earlier step of this approval%',
  'the same person cannot give two stages of one PO');

select tests.login('director');
select is(public.approval_decide(tests.request('order', pg_temp.v('po')), true, null),
          'approved', 'the Director''s approval completes the chain');
select tests.logout();
select is((select array[finance_reviewed_by, director_approved_by] from public.procurement_orders where id = pg_temp.v('po')),
          array[tests.uid('finance'), tests.uid('director')],
          'the PO stamps Finance and the Director from their own stages');

-- ── Releasing ────────────────────────────────────────────────────────────────
select tests.login('outsider');
select throws_ok(format('select public.release_order(%L)', pg_temp.v('po')),
  'Not authorized to release orders', 'only someone with the issue tick can release');
select tests.login('buyer');
select lives_ok(format('select public.release_order(%L)', pg_temp.v('po')), 'an approved PO can be released');
select tests.logout();
select is((select status::text from public.procurement_orders where id = pg_temp.v('po')), 'issued',
          'the released PO is live');

-- ── Receiving ────────────────────────────────────────────────────────────────
select tests.login('buyer');
select throws_ok(format($$select public.record_receipt(%L, null, '', %L::jsonb)$$,
                        pg_temp.v('po'), tests.receive(tests.order_line(pg_temp.v('po')), 4)),
  'Attach the GRN for this delivery', 'a receipt needs its GRN');
select throws_ok(format($$select public.record_receipt(%L, null, '', %L::jsonb, null, null, %L::jsonb)$$,
                        pg_temp.v('po'), tests.receive(tests.order_line(pg_temp.v('po')), 11), tests.grn(pg_temp.v('po'))),
  'Received quantity exceeds the ordered quantity on a line', 'more than was ordered cannot be received');
select throws_ok(format($$select public.record_receipt(%L, null, '', %L::jsonb, null, null, %L::jsonb)$$,
                        pg_temp.v('po'), tests.receive(tests.order_line(pg_temp.v('po')), 4),
                        jsonb_build_array(jsonb_build_object('kind', 'grn', 'name', 'g.pdf', 'path', 'elsewhere/g.pdf'))),
  'Invalid file path', 'a GRN must be stored under its own PO');

insert into t values ('r1', public.record_receipt(pg_temp.v('po'), null, '', tests.receive(tests.order_line(pg_temp.v('po')), 4),
                                                  null, null, tests.grn(pg_temp.v('po'))));
select tests.logout();
select is((select status::text from public.procurement_orders where id = pg_temp.v('po')), 'issued',
          'a part delivery leaves the PO open');

select tests.login('buyer');
select throws_ok(format($$select public.add_receipt_files(%L, %L::jsonb)$$, pg_temp.v('r1'), tests.grn(pg_temp.v('po'))),
  'This receipt already has a GRN; it cannot be replaced', 'a GRN can never be swapped');
select lives_ok(format($$select public.record_receipt(%L, null, '', %L::jsonb, null, null, %L::jsonb)$$,
                       pg_temp.v('po'), tests.receive(tests.order_line(pg_temp.v('po')), 6), tests.grn(pg_temp.v('po'))),
  'the rest of the delivery can be received');
select tests.logout();
select is((select status::text from public.procurement_orders where id = pg_temp.v('po')), 'closed',
          'receiving everything closes the PO');

select tests.login('buyer');
select throws_ok(format($$select public.record_receipt(%L, null, '', %L::jsonb, null, null, %L::jsonb)$$,
                        pg_temp.v('po'), tests.receive(tests.order_line(pg_temp.v('po')), 1), tests.grn(pg_temp.v('po'))),
  'Only a released PO can receive goods', 'a closed PO takes no more deliveries');
select throws_ok(
  format($$select public.create_orders_from_intent(%L,
    jsonb_build_array(jsonb_build_object('intent_line_id', %L::uuid, 'vendor_id', %L::uuid, 'rate', 90)),
    jsonb_build_array(jsonb_build_object('vendor_id', %L::uuid, 'support_file', 'x.pdf')))$$,
    tests.intent_of(pg_temp.v('il')), pg_temp.v('il'), pg_temp.v('vendor'), pg_temp.v('vendor')),
  'Nothing to order — these lines are already covered', 'a fully ordered intent cannot be ordered twice');
select tests.logout();

-- ── Cancelling frees the undelivered balance ─────────────────────────────────
insert into t values ('il2', tests.intent_line(pg_temp.v('project'), pg_temp.v('line'), 10));
insert into t values ('po2', tests.draft_po('buyer', pg_temp.v('il2'), pg_temp.v('vendor')));
select tests.approve('order', pg_temp.v('po2'), array['finance', 'director']);
select tests.login('buyer');
select public.release_order(pg_temp.v('po2'));
select public.record_receipt(pg_temp.v('po2'), null, '', tests.receive(tests.order_line(pg_temp.v('po2')), 3),
                             null, null, tests.grn(pg_temp.v('po2')));
select public.request_order_cancel(pg_temp.v('po2'), 'Vendor stopped delivering');
select throws_ok(format('select public.approve_order_cancel(%L)', pg_temp.v('po2')),
  'Not authorized to approve a cancellation (Director)', 'the buyer cannot approve their own cancellation request');
select tests.login('director');
select public.approve_order_cancel(pg_temp.v('po2'));
select tests.logout();
select is(public.intent_line_open_qty(pg_temp.v('il2')), 7::numeric,
          'cancelling frees the 7 not yet delivered for a new vendor');

select * from finish();
rollback;
