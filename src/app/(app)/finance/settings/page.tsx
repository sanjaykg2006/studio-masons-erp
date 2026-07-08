import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { can, requirePermission } from "@/core/rbac/can";
import { listBillingBranches } from "@/modules/finance/data";
import { BillingBranches } from "@/modules/finance/components/billing-branches";

/** Finance settings — the billing-branch list. */
export default async function FinanceSettingsPage() {
  await requirePermission("finance.settings", "read");

  const [branches, canManage] = await Promise.all([
    listBillingBranches(false),
    can("finance.settings", "manage"),
  ]);

  return (
    <div className="space-y-6">
      <Link
        href="/finance"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Finance
      </Link>
      <BillingBranches branches={branches} canManage={canManage} />
    </div>
  );
}
