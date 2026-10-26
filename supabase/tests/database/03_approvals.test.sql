-- The approval engine: who can give a stage, overrides, skips, amount rules,
-- edits reaching waiting items, project roles, and the waiting list.
begin;
\ir _helpers.psql
select plan(21);

-- ── Setup ────────────────────────────────────────────────────────────────────
select tests.person('admin', tests.role('T Admin', array['*:read', '*:update']));
select tests.person('billing', tests.role('T Billing'));
select tests.person('billing2', tests.role('T Billing 2'));
select tests.person('senior', tests.role('T Senior'));
select tests.person('cofounder', tests.role('T Co-Founder'));
select tests.person('staff', tests.role('T Staff'));
select tests.person('nobody_role_holder');  -- has no job title
select tests.person('pm', tests.role('T PM', array['procurement.intent:create']));
select tests.person('pd_a');  -- Project Director on Tower A only
select tests.person('pd_b');  -- Project Director on Tower B only

create function pg_temp.role_of(p_key text) returns uuid language sql stable as $$
  select role_id from public.profiles where id = tests.uid(p_key) $$;
create temp table t (k text primary key, v uuid);
grant all on t to authenticated;
create function pg_temp.v(p text) returns uuid language sql stable as $$ select v from t where k = p $$;
create function pg_temp.stage_count(p_flow text, p_item uuid) returns int language sql stable as $$
  select jsonb_array_length(stages) from public.approval_requests where flow_id = p_flow and item_id = p_item $$;
create function pg_temp.claim(p_key text, p_amount numeric) returns uuid language plpgsql as $$
declare v uuid;
begin
  perform tests.login(p_key);
  v := public.create_pettycash(null, null, 'reimbursement', p_amount, 'Test claim', current_date, null);
  perform tests.logout();
  return v;
end $$;

select tests.stages('pettycash', array[pg_temp.role_of('billing'), pg_temp.role_of('senior')]);

-- ── Who can give a stage ─────────────────────────────────────────────────────
insert into t values ('c1', pg_temp.claim('staff', 250));
select tests.login('senior');
select throws_like(format('select public.approval_decide(%L, true, null)', tests.request('pettycash', pg_temp.v('c1'))),
  'This is waiting for "Stage 1" — only T Billing can give it',
  'only the stage''s named role can give it');
select tests.login('nobody_role_holder');
select throws_like(format('select public.approval_decide(%L, false, null)', tests.request('pettycash', pg_temp.v('c1'))),
  'This is waiting for%', 'someone with no role cannot reject it either');

-- An administrator can step in, and it is recorded as an override.
select tests.login('admin');
select is(public.approval_decide(tests.request('pettycash', pg_temp.v('c1')), true, null), 'pending',
          'a full-access administrator can give a stage they don''t hold');
select tests.logout();
select ok((select is_override from public.approval_decisions where request_id = tests.request('pettycash', pg_temp.v('c1'))),
          'the administrator''s decision is stamped as an override');
select ok(exists (select 1 from public.audit_log where action = 'approval.override' and actor_id = tests.uid('admin')),
          'and written to the Activity Log');

insert into t values ('c_admin', pg_temp.claim('admin', 100));
select tests.login('admin');
select throws_ok(format('select public.approval_decide(%L, true, null)', tests.request('pettycash', pg_temp.v('c_admin'))),
  'You can''t approve or reject your own request', 'an administrator cannot approve their own request');
select tests.logout();

-- Turning down finishes the item with the reason.
select tests.login('senior');
select is(public.approval_decide(tests.request('pettycash', pg_temp.v('c1')), false, 'No receipt'), 'rejected',
          'the second stage can turn the claim down');
select tests.logout();
select is((select status::text || ' / ' || reject_reason from public.pettycash_entries where id = pg_temp.v('c1')),
          'rejected / No receipt', 'a turned-down claim is rejected with the reason');

-- ── Which stages an item gets ────────────────────────────────────────────────
update public.approval_stages set skip_job_title_ids = array[pg_temp.role_of('cofounder')]
 where flow_id = 'pettycash' and position = 2;
insert into t values ('c_cf', pg_temp.claim('cofounder', 250));
select is(pg_temp.stage_count('pettycash', pg_temp.v('c_cf')), 1,
          'a stage is skipped for the job titles on its skip list');
update public.approval_stages set skip_job_title_ids = '{}', min_amount = 500
 where flow_id = 'pettycash' and position = 2;
insert into t values ('c_small', pg_temp.claim('staff', 250));
insert into t values ('c_big', pg_temp.claim('staff', 800));
select is(pg_temp.stage_count('pettycash', pg_temp.v('c_small')), 1, 'an amount stage is left out below its amount');
select is(pg_temp.stage_count('pettycash', pg_temp.v('c_big')), 2, 'and included at or above it');
update public.approval_stages set min_amount = null where flow_id = 'pettycash' and position = 2;

-- ── Editing a stage reaches items already waiting ────────────────────────────
insert into t values ('c_wait', pg_temp.claim('staff', 300));   -- waiting at stage 1
insert into t values ('c_past', pg_temp.claim('staff', 300));   -- past stage 1
select tests.approve('pettycash', pg_temp.v('c_past'), array['billing']);
update public.approval_stages set role_id = pg_temp.role_of('billing2')
 where flow_id = 'pettycash' and position = 1;

select tests.login('billing');
select throws_like(format('select public.approval_decide(%L, true, null)', tests.request('pettycash', pg_temp.v('c_wait'))),
  'This is waiting for "Stage 1" — only T Billing 2 can give it',
  'after the edit, the old approver can no longer give the waiting item''s stage');
select tests.login('billing2');
select is(public.approval_decide(tests.request('pettycash', pg_temp.v('c_wait')), true, null), 'pending',
          'the new approver can');
select tests.logout();
select is((select (stages -> 0 ->> 'role_id')::uuid from public.approval_requests
            where id = tests.request('pettycash', pg_temp.v('c_past'))),
          pg_temp.role_of('billing'), 'a stage already given keeps the role it was given under');

-- ── Project roles count only on their own project ────────────────────────────
insert into t values ('pd', (select r.id from public.roles r join public.departments d on d.id = r.department_id
                              where d.key = 'project_management' and r.label = 'Project Director'));
insert into t values ('tower_a', tests.project('Tower A'));
insert into t values ('tower_b', tests.project('Tower B'));
insert into public.project_members (project_id, user_id, role_id) values
  (pg_temp.v('tower_a'), tests.uid('pd_a'), pg_temp.v('pd')),
  (pg_temp.v('tower_b'), tests.uid('pd_b'), pg_temp.v('pd'));
select tests.stages('intent', array[pg_temp.v('pd')]);
insert into t values ('line_a', tests.budget_line(pg_temp.v('tower_a'), 100));
select tests.login('pm');
insert into t values ('intent', public.raise_intent(pg_temp.v('tower_a'), null, null,
  jsonb_build_array(jsonb_build_object('budget_line_id', pg_temp.v('line_a'), 'qty', 5))));
select tests.login('pd_b');
select throws_like(format('select public.approval_decide(%L, true, null)', tests.request('intent', pg_temp.v('intent'))),
  'This is waiting for%', 'a Project Director on another project cannot approve this project''s intent');
select tests.login('pd_a');
select is(public.approval_decide(tests.request('intent', pg_temp.v('intent')), true, null), 'approved',
          'the Project Director on this project can');
select tests.logout();
select is((select status::text from public.procurement_intents where id = pg_temp.v('intent')), 'approved',
          'approving runs the outcome: the intent is approved');

-- ── The waiting list and the empty-role warning ──────────────────────────────
select tests.login('admin');
select is((select can_approve from public.list_waiting_approvals() where item_id = pg_temp.v('c_big')),
          array['Billing2'], 'the waiting list names who can give the stage now (after the edit above)');
select ok(not exists (select 1 from public.list_waiting_approvals() w
                      where w.item_id = pg_temp.v('c_big') and 'Staff' = any (w.can_approve)),
          'and never the requester');
select tests.login('staff');
select is((select count(*)::int from public.list_waiting_approvals()), 0,
          'someone without Access Control sees nothing on the waiting list');
select tests.logout();
select tests.stages('vendor', array[tests.role('T Empty role')]);
insert into t select 'vendor_stage', id from public.approval_stages where flow_id = 'vendor';
select tests.login('admin');
select is((select holders from public.approval_role_holders() where stage_id = pg_temp.v('vendor_stage')), 0,
          'a stage whose role nobody holds is reported with 0 holders (the red warning)');
select tests.logout();

select * from finish();
rollback;
