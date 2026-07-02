import { requirePermission, can } from "@/core/rbac/can";
import { listVendors } from "@/modules/procurement/data";
import { VendorDirectory } from "@/modules/procurement/components/vendor-directory";

/** Procurement home — the global vendor directory (slice 1). */
export default async function ProcurementPage() {
  await requirePermission("procurement.vendor", "read");
  const [vendors, canCreate, canUpdate, canApprove, canDelete] = await Promise.all([
    listVendors(),
    can("procurement.vendor", "create"),
    can("procurement.vendor", "update"),
    can("procurement.vendor", "approve"),
    can("procurement.vendor", "delete"),
  ]);
  return (
    <VendorDirectory
      vendors={vendors}
      canCreate={canCreate}
      canUpdate={canUpdate}
      canApprove={canApprove}
      canDelete={canDelete}
    />
  );
}
