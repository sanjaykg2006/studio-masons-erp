import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { requirePermission, can } from "@/core/rbac/can";
import { listVendors } from "@/modules/procurement/data";
import { VendorDirectory } from "@/modules/procurement/components/vendor-directory";

/** The Procurement department's global vendor directory (slice 1). */
export default async function ProcurementVendorsPage() {
  await requirePermission("procurement.vendor", "read");
  const [vendors, canCreate, canUpdate, canApprove, canDelete] = await Promise.all([
    listVendors(),
    can("procurement.vendor", "create"),
    can("procurement.vendor", "update"),
    can("procurement.vendor", "approve"),
    can("procurement.vendor", "delete"),
  ]);
  return (
    <div className="space-y-6">
      <Link
        href="/procurement"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Procurement
      </Link>
      <VendorDirectory
        vendors={vendors}
        canCreate={canCreate}
        canUpdate={canUpdate}
        canApprove={canApprove}
        canDelete={canDelete}
      />
    </div>
  );
}
