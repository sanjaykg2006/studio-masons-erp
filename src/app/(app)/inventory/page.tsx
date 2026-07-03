import { requirePermission, can } from "@/core/rbac/can";
import {
  getAssetPickers,
  listAssetCategoryTotals,
  listAssets,
} from "@/modules/inventory/data";
import { AssetRegistry } from "@/modules/inventory/components/asset-registry";

/** The company asset registry — machines, monitors, printers and their custodians. */
export default async function InventoryAssetsPage() {
  await requirePermission("inventory.asset", "read");

  const [assets, totals, pickers, canCreate, canManage, canDelete] = await Promise.all([
    listAssets(),
    listAssetCategoryTotals(),
    getAssetPickers(),
    can("inventory.asset", "create"),
    can("inventory.asset", "update"),
    can("inventory.asset", "delete"),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Company assets</h1>
        <p className="text-muted-foreground">
          The company&apos;s machines, monitors, printers and other reusable equipment — where each
          one is and who is responsible for it. Moving an asset to another project needs the new
          custodian to accept.
        </p>
      </div>

      <AssetRegistry
        assets={assets}
        totals={totals}
        projects={pickers.projects}
        people={pickers.people}
        canCreate={canCreate}
        canManage={canManage}
        canDelete={canDelete}
      />
    </div>
  );
}
