-- Studio-Masons ERP — reset to a clean slate for beta testing.
--
-- KEEPS  : your own login, and all SETUP — roles & their permission matrix,
--          departments & module allotments, brief templates, folder-access
--          rules, petty-cash categories, billing branches.
-- REMOVES: every other person, every project, the vendor directory, and all
--          the work hanging off them — tasks, RFIs, budgets, intents, POs,
--          receipts, invoices, petty cash, inventory, team grants, and the
--          whole activity log.
--
-- THIS CANNOT BE UNDONE. Run `npm run db:backup` first and copy the backup
-- folder somewhere safe before you run this.
--
-- HOW TO RUN: Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
-- The whole thing is one transaction: if any part fails, nothing changes.

do $$
declare
  -- >>> PUT YOUR OWN LOGIN EMAIL HERE <<<
  keep_email constant text := 'sanjaykg1302@gmail.com';

  -- Everything below gets emptied.
  wipe constant text[] := array[
    -- history
    'audit_log', 'error_logs',
    -- projects and everything hanging off them
    'projects', 'project_members', 'project_steps',
    'project_briefs', 'project_brief_answers',
    'project_change_requests', 'project_files',
    -- tasks
    'tasks', 'task_attachments', 'task_invites',
    -- RFIs
    'rfis', 'rfi_messages', 'rfi_attachments',
    -- procurement
    'procurement_budgets', 'procurement_budget_packages',
    'procurement_budget_lines',
    'procurement_intents', 'procurement_intent_lines',
    'procurement_orders', 'procurement_order_lines',
    'procurement_order_amendments',
    'procurement_receipts', 'procurement_receipt_lines',
    'procurement_vendors',
    -- inventory
    'inventory_assets', 'inventory_asset_transfers', 'inventory_consumption',
    -- finance
    'finance_invoices', 'finance_invoice_lines',
    'finance_payment_requests', 'finance_retention',
    'pettycash_entries',
    -- per-person access grants (these belong to the departing people)
    'team_members', 'team_member_permissions',
    'department_leads', 'subteam_members'
  ];

  keep_id  uuid;
  targets  text[] := '{}';
  t        text;
  r        record;
  n        bigint;
  leftover text := '';
begin
  -- 0. Refuse to run if we can't find you — better to stop than lock you out.
  select id into keep_id
  from auth.users
  where lower(email) = lower(trim(keep_email));

  if keep_id is null then
    raise exception
      'No login found for "%". Fix the email at the top and re-run.', keep_email;
  end if;

  -- 1. Empty the work tables. Any table that no longer exists is skipped, so
  --    this stays safe as the schema evolves.
  foreach t in array wipe loop
    if to_regclass('public.' || t) is not null then
      targets := targets || format('public.%I', t);
    end if;
  end loop;

  execute 'truncate table ' || array_to_string(targets, ', ')
          || ' restart identity cascade';

  -- 2. Setup rows still record who created them. Point those at you (or clear
  --    them) so nothing is left holding on to a departing person.
  for r in
    select c.relname as tbl, a.attname as col, a.attnotnull as required
    from pg_constraint fk
    join pg_class     c on c.oid = fk.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = fk.conrelid
                       and a.attnum = fk.conkey[1]
    where fk.contype   = 'f'
      and fk.confrelid = 'public.profiles'::regclass
      and cardinality(fk.conkey) = 1
      and n.nspname = 'public'
      and c.relkind = 'r'
  loop
    if r.required then
      execute format('update public.%I set %I = $1 where %I <> $1',
                     r.tbl, r.col, r.col) using keep_id;
    else
      execute format('update public.%I set %I = null where %I <> $1',
                     r.tbl, r.col, r.col) using keep_id;
    end if;
  end loop;

  -- 3. The people themselves.
  delete from public.profiles where id <> keep_id;
  delete from auth.users       where id <> keep_id;

  -- 4. Prove it worked. If anything is still holding rows, blow up and roll the
  --    whole thing back rather than quietly half-finishing.
  foreach t in array wipe loop
    if to_regclass('public.' || t) is not null then
      execute format('select count(*) from public.%I', t) into n;
      if n > 0 then
        leftover := leftover || format('  %s: %s rows%s', t, n, chr(10));
      end if;
    end if;
  end loop;

  if leftover <> '' then
    raise exception E'These tables did not empty:\n%', leftover;
  end if;

  raise notice 'Clean slate ready. Kept % and all setup data.', keep_email;
end $$;
