// Pure Inventory types — safe to import from client components.

// ── Project material (Budget-BOQ-driven) ─────────────────────────────────────

/** One budget line's stock position on a project (from list_project_material_stock). */
export type MaterialStock = {
  budget_line_id: string;
  package_name: string;
  ref: string | null;
  description: string;
  unit: string | null;
  ordered: number;
  received: number;
  consumed: number;
  on_hand: number;
};

/** A consumption log entry (from list_project_consumption). */
export type ConsumptionEntry = {
  id: string;
  budget_line_id: string;
  description: string;
  unit: string | null;
  qty: number;
  consumed_on: string;
  note: string | null;
  recorded_by: string | null;
  recorded_name: string | null;
  created_at: string;
  can_delete: boolean;
};

// ── Company assets ───────────────────────────────────────────────────────────

export type AssetStatus = "in_use" | "idle" | "retired";

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  in_use: "In use",
  idle: "Idle",
  retired: "Retired",
};

/** An asset row from list_assets, with its current pending transfer (if any). */
export type Asset = {
  id: string;
  tag: string | null;
  name: string;
  category: string;
  status: AssetStatus;
  current_project_id: string | null;
  current_project_name: string | null;
  custodian_id: string | null;
  custodian_name: string | null;
  notes: string | null;
  pending_transfer_id: string | null;
  pending_to_project_name: string | null;
  pending_to_custodian_name: string | null;
  is_incoming_to_me: boolean;
  can_manage: boolean;
};

/** A {category, count} row from asset_category_totals. */
export type AssetCategoryTotal = { category: string; count: number };

/** An {id, name} option for the project / custodian pickers. */
export type PickerOption = { id: string; name: string };

/** The editable fields on an asset (create + edit share this shape). */
export type AssetInput = {
  name: string;
  category: string;
  tag: string;
  notes: string;
};
