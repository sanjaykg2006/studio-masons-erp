-- Studio-Masons ERP — Finance: correct the TDS + retention base, add rounding
-- Run AFTER 0060_finance.sql.
--
-- WHY  The invoice money math in 0060 computed TDS and retention on the
--   GST-inclusive amount, which over-deducts both and short-pays vendors.
--   Confirmed business rules:
--     • TDS      = tds% of the WORK value (base + other charges), GST excluded.
--     • Retention = 5% of the BASE (work) value.
--   Also:
--     • Round money to 2 decimals (paise) so amounts + Tally exports are clean.
--     • Generate the internal invoice number from the highest existing suffix
--       (not a row count), so deleting a draft can't make the next one reuse a
--       number.
--
-- Only two functions change; everything else in 0060 stays as-is. Both are
-- create-or-replace, so this is safe to re-run and easy to revert.

-- ── PM enters an invoice (rounding + safer invoice number) ────────────────────
create or replace function public.create_invoice(
  p_order uuid, p_vendor_invoice_no text, p_vendor_invoice_date date,
  p_due_date date, p_lines jsonb, p_file text, p_remarks text
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_project uuid; v_vendor uuid; v_ostatus public.procurement_order_status;
  v_accept text; v_fixed boolean; v_cstart date; v_cend date;
  v_base numeric := 0; v_gst numeric := 0; v_total numeric; v_seq int;
  v_invoice uuid; a jsonb; v_i int := 0; v_b numeric; v_s numeric; v_c numeric; v_ig numeric;
begin
  select project_id, vendor_id, status, acceptance_file, fixed_contract, contract_start, contract_end
    into v_project, v_vendor, v_ostatus, v_accept, v_fixed, v_cstart, v_cend
  from public.procurement_orders where id = p_order;
  if v_project is null then raise exception 'Purchase order not found'; end if;
  if not public.has_project_permission(v_project, 'finance.invoice', 'create') then
    raise exception 'Not authorized to enter invoices on this project';
  end if;
  if v_ostatus not in ('issued', 'closed', 'amending') then
    raise exception 'Invoices can only be raised against a released purchase order';
  end if;
  if v_accept is null then
    raise exception 'Upload the vendor''s acceptance letter on the purchase order before invoicing';
  end if;
  if coalesce(trim(p_vendor_invoice_no), '') = '' then raise exception 'Enter the vendor''s invoice number'; end if;
  if p_vendor_invoice_date is null then raise exception 'Enter the vendor''s invoice date'; end if;

  -- Fixed-contract window check.
  if v_fixed then
    if (v_cstart is not null and p_vendor_invoice_date < v_cstart)
       or (v_cend is not null and p_vendor_invoice_date > v_cend) then
      raise exception 'Invoice date % is outside the vendor''s contract period (% to %)',
        p_vendor_invoice_date, v_cstart, v_cend;
    end if;
  end if;

  -- Duplicate guard: same vendor + vendor invoice number, not rejected.
  if exists (
    select 1 from public.finance_invoices
    where vendor_id = v_vendor and lower(vendor_invoice_no) = lower(trim(p_vendor_invoice_no))
      and status <> 'rejected'
  ) then
    raise exception 'An invoice with number "%" already exists for this vendor', trim(p_vendor_invoice_no);
  end if;

  -- Tally the base + GST from the lines (at least one positive base required).
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one invoice line';
  end if;
  for a in select value from jsonb_array_elements(p_lines) loop
    v_b := coalesce((a->>'base')::numeric, 0);
    if v_b <= 0 then continue; end if;
    v_s := coalesce((a->>'sgst')::numeric, 0);
    v_c := coalesce((a->>'cgst')::numeric, 0);
    v_ig := coalesce((a->>'igst')::numeric, 0);
    v_base := v_base + v_b;
    v_gst  := v_gst + v_b * (v_s + v_c + v_ig) / 100;
  end loop;
  if v_base <= 0 then raise exception 'Enter a base value on at least one line'; end if;
  v_gst   := round(v_gst, 2);
  v_total := round(v_base + v_gst, 2);

  -- Note: the PO cap (cumulative base ≤ PO value) is NOT blocked at entry. An
  -- over-cap invoice is created but flagged (see invoice_over_cap); Director approval
  -- is blocked until a Director/MD records an override (bypass_invoice_cap).

  -- Next internal number = highest existing suffix + 1 (so deleting a draft can't
  -- make a later invoice reuse a number).
  select coalesce(max(nullif(regexp_replace(invoice_no, '\D', '', 'g'), '')::int), 0) + 1
    into v_seq from public.finance_invoices where project_id = v_project;
  insert into public.finance_invoices
    (project_id, order_id, vendor_id, invoice_no, vendor_invoice_no, vendor_invoice_date,
     due_date, base_value, gst_amount, amount_total, amount_payable, file_path, remarks)
  values
    (v_project, p_order, v_vendor, 'SM-INV-' || lpad(v_seq::text, 4, '0'),
     trim(p_vendor_invoice_no), p_vendor_invoice_date, p_due_date,
     v_base, v_gst, v_total, v_total, nullif(trim(p_file), ''), nullif(trim(p_remarks), ''))
  returning id into v_invoice;

  for a in select value from jsonb_array_elements(p_lines) loop
    v_b := coalesce((a->>'base')::numeric, 0);
    if v_b <= 0 then continue; end if;
    insert into public.finance_invoice_lines (invoice_id, base, sgst, cgst, igst, sort)
    values (v_invoice, v_b, coalesce((a->>'sgst')::numeric, 0),
            coalesce((a->>'cgst')::numeric, 0), coalesce((a->>'igst')::numeric, 0), v_i);
    v_i := v_i + 1;
  end loop;

  return v_invoice;
end;
$$;

-- ── Accounts books the invoice (corrected TDS + retention base, rounding) ─────
create or replace function public.accounts_approve_invoice(
  p_invoice uuid, p_lines jsonb, p_other_charges numeric, p_tds_pct numeric,
  p_deduct_advance boolean, p_advance_amount numeric, p_hold_retention boolean, p_remarks text
)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_project uuid; v_order uuid; v_status public.finance_invoice_status; v_bypass timestamptz;
  v_base numeric := 0; v_gst numeric := 0; v_other numeric; v_subtotal numeric;
  v_adv_rem numeric; v_deduct numeric := 0; v_tds numeric := 0; v_ret numeric := 0; v_payable numeric;
  a jsonb; v_b numeric; v_s numeric; v_c numeric; v_ig numeric; v_i int := 0;
begin
  select project_id, order_id, status, cap_bypass_at
    into v_project, v_order, v_status, v_bypass
  from public.finance_invoices where id = p_invoice;
  if v_project is null then raise exception 'Invoice not found'; end if;
  if not public.has_project_permission(v_project, 'finance.invoice', 'review') then
    raise exception 'Not authorized to book invoices (Accounts)';
  end if;
  if v_status <> 'pending_accounts' then raise exception 'This invoice is not awaiting accounts approval'; end if;

  -- Recompute base + GST from the (possibly adjusted) lines.
  if p_lines is not null and jsonb_array_length(p_lines) > 0 then
    delete from public.finance_invoice_lines where invoice_id = p_invoice;
    for a in select value from jsonb_array_elements(p_lines) loop
      v_b := coalesce((a->>'base')::numeric, 0);
      if v_b <= 0 then continue; end if;
      v_s := coalesce((a->>'sgst')::numeric, 0);
      v_c := coalesce((a->>'cgst')::numeric, 0);
      v_ig := coalesce((a->>'igst')::numeric, 0);
      v_base := v_base + v_b;
      v_gst  := v_gst + v_b * (v_s + v_c + v_ig) / 100;
      insert into public.finance_invoice_lines (invoice_id, base, sgst, cgst, igst, sort)
      values (p_invoice, v_b, v_s, v_c, v_ig, v_i);
      v_i := v_i + 1;
    end loop;
  else
    select coalesce(sum(base), 0), coalesce(sum(base * (sgst + cgst + igst) / 100), 0)
      into v_base, v_gst from public.finance_invoice_lines where invoice_id = p_invoice;
  end if;
  if v_base <= 0 then raise exception 'The invoice needs a base value'; end if;

  -- Re-check the PO cap unless a senior bypass is on file.
  if v_bypass is null then
    if (public.order_invoiced_base(v_order) - (
          select base_value from public.finance_invoices where id = p_invoice
        )) + v_base > public.order_total_value(v_order) then
      raise exception 'The adjusted base value exceeds the PO cap — apply a Director/MD override first';
    end if;
  end if;

  v_gst      := round(v_gst, 2);
  v_other    := round(coalesce(p_other_charges, 0), 2);
  v_subtotal := round(v_base + v_gst + v_other, 2);   -- the full bill: base + GST + other

  -- Advance recovery (capped at what's left on the PO advance and the bill).
  if coalesce(p_deduct_advance, false) then
    v_adv_rem := public.order_advance_remaining(v_order);
    v_deduct  := least(coalesce(p_advance_amount, 0), v_subtotal, v_adv_rem);
    if v_deduct < 0 then v_deduct := 0; end if;
  end if;

  -- TDS is charged on the WORK value (base + other charges); GST is excluded.
  v_tds := round((v_base + v_other) * coalesce(p_tds_pct, 0) / 100, 2);

  -- Retention is 5% of the BASE (work) value.
  if coalesce(p_hold_retention, false) then
    v_ret := round(v_base * 0.05, 2);
  end if;

  v_payable := greatest(0, round(v_subtotal - v_deduct - v_tds - v_ret, 2));

  update public.finance_invoices set
    status = 'approved',
    base_value = v_base, gst_amount = v_gst, other_charges = v_other,
    amount_total = v_subtotal,
    tds_pct = p_tds_pct, tds_amount = v_tds,
    advance_deducted = v_deduct,
    retention_held = coalesce(p_hold_retention, false), retention_amount = v_ret,
    amount_payable = v_payable,
    remarks = coalesce(nullif(trim(p_remarks), ''), remarks),
    accounts_approved_by = auth.uid(), accounts_approved_at = now()
  where id = p_invoice;

  -- Consume the advance against the PO.
  if v_deduct > 0 then
    update public.procurement_orders
       set advance_consumed = coalesce(advance_consumed, 0) + v_deduct
     where id = v_order;
  end if;

  -- Open a retention register row, due 12 months out.
  if v_ret > 0 then
    insert into public.finance_retention (project_id, invoice_id, amount, due_date)
    values (v_project, p_invoice, v_ret, (current_date + interval '12 months')::date);
  end if;
end;
$$;
