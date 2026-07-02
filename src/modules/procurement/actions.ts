"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { authorize } from "@/core/rbac/can";
import { logAudit } from "@/modules/audit/log";
import type { VendorInput, VendorStatus } from "@/modules/procurement/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const ok: ActionResult = { ok: true };
const fail = (error: string): ActionResult => ({ ok: false, error });

const refresh = () => revalidatePath("/procurement");

/** Trim to a value or null, so blank fields don't store empty strings. */
const clean = (s: string | undefined) => {
  const t = (s ?? "").trim();
  return t.length ? t : null;
};

/** The editable columns, cleaned, shared by create and update. */
function vendorColumns(input: VendorInput) {
  return {
    name: input.name.trim(),
    type: input.type,
    trade: clean(input.trade),
    contact_name: clean(input.contact_name),
    contact_phone: clean(input.contact_phone),
    contact_email: clean(input.contact_email),
  };
}

/** Add a vendor to the directory. Lands as "Pending" until Finance approves. */
export async function createVendor(input: VendorInput): Promise<ActionResult> {
  if (!input.name.trim()) return fail("Enter a vendor name.");
  const denied = await authorize("procurement.vendor", "create");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.from("procurement_vendors").insert(vendorColumns(input));
  if (error) return fail(error.message);
  await logAudit("procurement.vendor.create", `Added vendor "${input.name.trim()}"`);
  refresh();
  return ok;
}

/** Edit a vendor's details. */
export async function updateVendor(vendorId: string, input: VendorInput): Promise<ActionResult> {
  if (!input.name.trim()) return fail("Enter a vendor name.");
  const denied = await authorize("procurement.vendor", "update");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase
    .from("procurement_vendors")
    .update(vendorColumns(input))
    .eq("id", vendorId);
  if (error) return fail(error.message);
  await logAudit("procurement.vendor.update", `Edited vendor "${input.name.trim()}"`, { vendorId });
  refresh();
  return ok;
}

/** Set a vendor's legitimacy status — the Finance approval gate (approve verb). */
export async function setVendorStatus(vendorId: string, status: VendorStatus): Promise<ActionResult> {
  const denied = await authorize("procurement.vendor", "approve");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_vendor_status", {
    p_vendor: vendorId,
    p_status: status,
  });
  if (error) return fail(error.message);
  await logAudit("procurement.vendor.status", `Set a vendor to "${status}"`, { vendorId, status });
  refresh();
  return ok;
}

/** Remove a vendor from the directory (delete verb). */
export async function deleteVendor(vendorId: string): Promise<ActionResult> {
  const denied = await authorize("procurement.vendor", "delete");
  if (denied) return denied;

  const supabase = await createClient();
  const { error } = await supabase.from("procurement_vendors").delete().eq("id", vendorId);
  if (error) return fail(error.message);
  await logAudit("procurement.vendor.delete", "Removed a vendor", { vendorId });
  refresh();
  return ok;
}
