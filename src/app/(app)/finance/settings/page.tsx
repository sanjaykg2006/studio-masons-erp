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

  return <BillingBranches branches={branches} canManage={canManage} />;
}
