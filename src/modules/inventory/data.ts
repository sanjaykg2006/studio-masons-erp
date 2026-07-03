import "server-only";

import { createClient } from "@/core/supabase/server";
import type {
  Asset,
  AssetCategoryTotal,
  ConsumptionEntry,
  MaterialStock,
  PickerOption,
} from "@/modules/inventory/types";

/** A project's per-budget-line material stock (RLS-gated by inventory.stock:read). */
export async function listProjectMaterialStock(projectId: string): Promise<MaterialStock[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_material_stock", { p_project: projectId });
  return (data ?? []) as MaterialStock[];
}

/** The project's consumption log. */
export async function listProjectConsumption(projectId: string): Promise<ConsumptionEntry[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_consumption", { p_project: projectId });
  return (data ?? []) as ConsumptionEntry[];
}

/** The whole company asset registry (RLS-gated by inventory.asset:read). */
export async function listAssets(): Promise<Asset[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_assets");
  return (data ?? []) as Asset[];
}

/** Asset counts per category, for the totals strip. */
export async function listAssetCategoryTotals(): Promise<AssetCategoryTotal[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("asset_category_totals");
  return (data ?? []) as AssetCategoryTotal[];
}

/** Project + people options for the transfer / assign pickers. */
export async function getAssetPickers(): Promise<{
  projects: PickerOption[];
  people: PickerOption[];
}> {
  const supabase = await createClient();
  const [{ data: projects }, { data: people }] = await Promise.all([
    supabase.rpc("list_asset_projects"),
    supabase.rpc("list_asset_people"),
  ]);
  return {
    projects: (projects ?? []) as PickerOption[],
    people: (people ?? []) as PickerOption[],
  };
}
