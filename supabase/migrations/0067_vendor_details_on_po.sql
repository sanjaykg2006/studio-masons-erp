-- Studio-Masons ERP — surface the vendor's registered details on the PO document
-- Run AFTER 0066_error_log_user_note.sql.
--
-- BACKGROUND
--   procurement_vendors already carries address / gst / pan (from 0036), but the app
--   never read or wrote them. To let the purchase-order document pull the vendor's
--   GST + address straight from the directory (instead of retyping them), we widen
--   the two read functions:
--     1. list_vendors() also returns address + gst + pan (for the directory + its
--        edit form, which pre-fills from this).
--     2. get_order() also returns the vendor's address + GSTIN (for the PO document).
--   Both are pure column additions — no data changes, no new tables, nothing dropped
--   but the functions themselves (required to change a `returns table` shape).

-- 1. list_vendors — carry the vendor's registered details ----------------------
drop function if exists public.list_vendors();
create or replace function public.list_vendors()
returns table (
  id uuid, name text, type public.procurement_vendor_type, trade text,
  contact_name text, contact_phone text, contact_email text,
  address text, gst text, pan text,
  status public.procurement_vendor_status,
  approved_by uuid, approved_by_name text, approved_at timestamptz,
  created_at timestamptz
)
language sql stable security definer set search_path = public
as $$
  select v.id, v.name, v.type, v.trade,
         v.contact_name, v.contact_phone, v.contact_email,
         v.address, v.gst, v.pan,
         v.status,
         v.approved_by, coalesce(p.full_name, p.email), v.approved_at,
         v.created_at
  from public.procurement_vendors v
  left join public.profiles p on p.id = v.approved_by
  where public.has_permission('procurement.vendor', 'read')
  order by v.name;
$$;

-- 2. get_order — carry the vendor's address + GSTIN onto the PO ----------------
-- Identical to 0056 but for the two extra vendor columns (v.address, v.gst).
drop function if exists public.get_order(uuid);
create or replace function public.get_order(p_order uuid)
returns table (
  id uuid, po_number text, intent_id uuid,
  vendor_name text, vendor_trade text, vendor_type public.procurement_vendor_type,
  vendor_contact_name text, vendor_contact_phone text, vendor_contact_email text,
  vendor_address text, vendor_gstin text,
  status public.procurement_order_status, notes text,
  version_no int, over_budget boolean,
  po_file text, acceptance_file text, support_file text,
  finance_reviewed_by uuid, finance_reviewed_name text,
  director_approved_by uuid, director_approved_name text,
  senior_bypass_by uuid, senior_bypass_name text,
  issued_at timestamptz,
  cancel_reason text, cancel_requested_by uuid, cancel_requested_name text,
  cancelled_by uuid, cancelled_name text,
  can_review boolean, can_approve boolean, can_issue boolean,
  can_receive boolean, can_amend boolean,
  can_cancel boolean, can_approve_cancel boolean, can_bypass boolean
)
language sql stable security definer set search_path = public
as $$
  select o.id, o.po_number, o.intent_id,
         v.name, v.trade, v.type,
         v.contact_name, v.contact_phone, v.contact_email,
         v.address, v.gst,
         o.status, o.notes,
         o.version_no, public.order_over_budget_now(o.id),
         o.po_file, o.acceptance_file, o.support_file,
         o.finance_reviewed_by, coalesce(fp.full_name, fp.email),
         o.director_approved_by, coalesce(dp.full_name, dp.email),
         o.senior_bypass_by, coalesce(sp.full_name, sp.email),
         o.issued_at,
         o.cancel_reason, o.cancel_requested_by, coalesce(cp.full_name, cp.email),
         o.cancelled_by, coalesce(xp.full_name, xp.email),
         public.has_project_permission(o.project_id, 'procurement.order', 'review'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'issue'),
         public.has_project_permission(o.project_id, 'procurement.receipt', 'create'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_project_permission(o.project_id, 'procurement.order', 'update'),
         public.has_project_permission(o.project_id, 'procurement.order', 'approve'),
         public.has_project_permission(o.project_id, 'procurement.order', 'manage')
  from public.procurement_orders o
  join public.procurement_vendors v on v.id = o.vendor_id
  left join public.profiles fp on fp.id = o.finance_reviewed_by
  left join public.profiles dp on dp.id = o.director_approved_by
  left join public.profiles sp on sp.id = o.senior_bypass_by
  left join public.profiles cp on cp.id = o.cancel_requested_by
  left join public.profiles xp on xp.id = o.cancelled_by
  where o.id = p_order
    and public.has_project_permission(o.project_id, 'procurement.order', 'read');
$$;
