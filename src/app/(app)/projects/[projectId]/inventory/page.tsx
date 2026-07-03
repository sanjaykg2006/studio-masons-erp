import { notFound } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import { requireProjectPermission, canOnProject, can } from "@/core/rbac/can";
import {
  getAssetPickers,
  listAssetCategoryTotals,
  listAssets,
  listProjectConsumption,
  listProjectMaterialStock,
} from "@/modules/inventory/data";
import { InventoryView } from "@/modules/inventory/components/inventory-view";

/** A project's Inventory area — material tracker (Budget BOQ) + company assets. */
export default async function ProjectInventoryPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "inventory.stock", "read");

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const [stock, consumption, canRecord, canManageStock, canSeeAssets] = await Promise.all([
    listProjectMaterialStock(projectId),
    listProjectConsumption(projectId),
    canOnProject(projectId, "inventory.stock", "create"),
    canOnProject(projectId, "inventory.stock", "update"),
    can("inventory.asset", "read"),
  ]);

  const [assets, assetTotals, pickers, canCreateAsset, canManageAsset, canDeleteAsset] =
    await Promise.all([
      canSeeAssets ? listAssets() : Promise.resolve([]),
      canSeeAssets ? listAssetCategoryTotals() : Promise.resolve([]),
      canSeeAssets ? getAssetPickers() : Promise.resolve({ projects: [], people: [] }),
      canSeeAssets ? can("inventory.asset", "create") : Promise.resolve(false),
      canSeeAssets ? can("inventory.asset", "update") : Promise.resolve(false),
      canSeeAssets ? can("inventory.asset", "delete") : Promise.resolve(false),
    ]);

  return (
    <InventoryView
      projectId={projectId}
      projectName={project.name as string}
      stock={stock}
      consumption={consumption}
      canRecord={canRecord}
      canManageStock={canManageStock}
      assets={assets}
      assetTotals={assetTotals}
      projects={pickers.projects}
      people={pickers.people}
      canSeeAssets={canSeeAssets}
      canCreateAsset={canCreateAsset}
      canManageAsset={canManageAsset}
      canDeleteAsset={canDeleteAsset}
    />
  );
}
