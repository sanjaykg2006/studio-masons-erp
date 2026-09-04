"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { logAudit } from "@/modules/audit/log";
import { parseBudgetWorkbook } from "@/modules/procurement/import/parse";
import type {
  BudgetImportPackage,
  BudgetImportPreview,
} from "@/modules/procurement/types";

export type ActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): ActionResult => ({ ok: false, error });

async function fileBuffer(formData: FormData): Promise<ArrayBuffer | null> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return null;
  return file.arrayBuffer();
}

// ── Budget ───────────────────────────────────────────────────────────────────

export async function previewBudgetImport(
  formData: FormData
): Promise<{ ok: true; preview: BudgetImportPreview } | { ok: false; error: string }> {
  const buf = await fileBuffer(formData);
  if (!buf) return { ok: false, error: "Choose a spreadsheet (.xlsx)." };
  try {
    return { ok: true, preview: await parseBudgetWorkbook(buf) };
  } catch (e) {
    return { ok: false, error: `Could not read the workbook: ${(e as Error).message}` };
  }
}

export async function commitBudgetImport(
  projectId: string,
  packages: BudgetImportPackage[]
): Promise<ActionResult> {
  if (packages.length === 0) return fail("Nothing to import.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("import_budget", {
    p_project: projectId,
    p_packages: packages.map((p) => ({
      name: p.name,
      lines: p.lines.map((l) => ({
        ref: l.ref,
        description: l.description,
        unit: l.unit,
        qty: l.qty,
        rate: l.rate,
        supply_rate: l.supplyRate,
        install_rate: l.installRate,
        supply_amount: l.supplyAmount,
        install_amount: l.installAmount,
      })),
    })),
  });
  if (error) return fail(error.message);
  await logAudit("procurement.budget.import", `Imported ${packages.length} budget package(s)`, { projectId });
  revalidatePath(`/projects/${projectId}/budget`);
  return { ok: true };
}
