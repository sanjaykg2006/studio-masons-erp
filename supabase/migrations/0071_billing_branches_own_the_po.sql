-- Studio-Masons ERP — Finance owns the PO billing branches
-- Run AFTER 0070_budget_split_rates.sql.
--
-- THE PROBLEM
--   There were two unrelated lists of billing branches. Finance managed the
--   `billing_branches` table (Finance -> Settings), while the PO generator read a
--   BILLING_BRANCHES constant compiled into the source code. The dropdown on the
--   PO screen therefore showed branches nobody had entered, and a GSTIN
--   corrected by Finance could never reach a printed purchase order — it would
--   have needed a code change and a redeploy.
--
--   A wrong GSTIN on a real PO reaches a vendor's accounts team, so the printed
--   document must come from the list the finance team actually maintains.
--
-- WHAT THIS DOES
--   1. Adds `place_of_supply`, the one field the printed billing block needs
--      that the table did not yet carry.
--   2. Copies the six branches that were hardcoded into the table ONCE, so
--      nothing is lost and POs keep printing while Finance takes over. Matched
--      on GSTIN, so a branch Finance has already entered is never duplicated.
--
--   After this the code holds no branch data at all. Finance adds, edits and
--   deactivates them in Finance -> Settings, and a correction shows up on the
--   next PO immediately. Any of the seeded rows can be deactivated or deleted
--   there if it is out of date.

alter table public.billing_branches
  add column if not exists place_of_supply text;

comment on column public.billing_branches.place_of_supply is
  'State printed as "Place of Supply" on the PO billing block.';

-- One-time carry-over of what used to live in po-terms.ts. Skipped for any GSTIN
-- already present, so re-running changes nothing.
insert into public.billing_branches (name, gstin, address, place_of_supply, active)
select v.name, v.gstin, v.address, v.place_of_supply, true
from (values
  ('Karnataka — Bangalore (Head Office)', '29ABFCS4554A1ZE',
   E'No. 699, 7th Main, 2nd Floor, HAL 2nd Stage\nIndiranagar, Bangalore 560008',
   'Karnataka'),
  ('Delhi — New Delhi', '07ABFCS4554A1ZK',
   E'KH/Mustatli, No-154, Lilla No 19/2\nDesk No: E2, 2nd Floor Back Side Office No 4\nMaster Space Plote NO -27, Najafgarh Dichaon Road\nNew Delhi, Delhi - 110043',
   'Delhi'),
  ('Andhra Pradesh — Visakhapatnam', '37ABFCS4554A1ZH',
   E'No 6-10-27, East Point Colony, Sri Ganga\nMandir Street, Pedda Waltair\nVisakhapatnam\nAndhra Pradesh - 530017',
   'Andhra Pradesh'),
  ('Tamil Nadu — Chennai', '33ABFCS4554A1ZP',
   E'Plot No. 33, Door No.155\nSapthagiri Nagar, Main Road\nSholinganallur, Chennai - 600119',
   'Tamil Nadu'),
  ('Telangana — Hyderabad', '36ABFCS4554A1ZJ',
   E'RAM SVR, Plot No 4/2, Sector 1, Rent A Desk\nMadhapur, HUDA Techno Enclave\nHITEC City, Hyderabad - 500081',
   'Telangana'),
  ('Maharashtra — Raigad', '27ABFCS4554A1ZI',
   E'No. 1513 Room No 2, Pandwadevi Road\nAlibag, Poynad, Ambepur, Raigad\nMaharashtra - 402108',
   'Maharashtra')
) as v(name, gstin, address, place_of_supply)
where not exists (
  select 1 from public.billing_branches b where b.gstin = v.gstin
);

-- Listing now carries place_of_supply so the PO can print the full block.
-- Dropped first: a function's return type can't be widened in place.
drop function if exists public.list_billing_branches(boolean);
create or replace function public.list_billing_branches(p_active_only boolean default false)
returns table (
  id uuid, name text, gstin text, address text,
  place_of_supply text, active boolean
)
language sql stable security definer set search_path = public as $$
  select id, name, gstin, address, place_of_supply, active
  from public.billing_branches
  where auth.uid() is not null and (not p_active_only or active)
  order by name;
$$;

-- Finance can now set the Place of Supply too. The old 4-argument version is
-- dropped rather than left in place: keeping both would make a 4-argument call
-- ambiguous against the new one's defaulted 5th argument.
drop function if exists public.upsert_billing_branch(uuid, text, text, text);
create or replace function public.upsert_billing_branch(
  p_id uuid, p_name text, p_gstin text, p_address text,
  p_place_of_supply text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.has_permission('finance.settings', 'manage') then
    raise exception 'Not authorized to manage billing branches';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter a branch name'; end if;
  if p_id is null then
    insert into public.billing_branches (name, gstin, address, place_of_supply)
    values (trim(p_name), nullif(trim(p_gstin), ''), nullif(trim(p_address), ''),
            nullif(trim(p_place_of_supply), ''))
    returning id into v_id;
  else
    update public.billing_branches
       set name = trim(p_name),
           gstin = nullif(trim(p_gstin), ''),
           address = nullif(trim(p_address), ''),
           place_of_supply = nullif(trim(p_place_of_supply), '')
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'Branch not found'; end if;
  end if;
  return v_id;
end;
$$;
