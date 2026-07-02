"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/core/supabase/server";
import { logAudit } from "@/modules/audit/log";
import { parseBudgetWorkbook, parseComparisonWorkbook } from "@/modules/procurement/import/parse";
import type {
  BudgetImportPackage,
  BudgetImportPreview,
  ComparisonImportPackage,
  ComparisonImportPreview,
  Vendor,
  VendorMatch,
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
      })),
    })),
  });
  if (error) return fail(error.message);
  await logAudit("procurement.budget.import", `Imported ${packages.length} budget package(s)`, { projectId });
  revalidatePath(`/projects/${projectId}/budget`);
  return { ok: true };
}

// ── Comparison ───────────────────────────────────────────────────────────────

/** Parse a comparison workbook and match its vendor names to approved vendors. */
export async function previewComparisonImport(
  formData: FormData
): Promise<{ ok: true; preview: ComparisonImportPreview } | { ok: false; error: string }> {
  const buf = await fileBuffer(formData);
  if (!buf) return { ok: false, error: "Choose a spreadsheet (.xlsx)." };
  let preview: ComparisonImportPreview;
  try {
    preview = await parseComparisonWorkbook(buf);
  } catch (e) {
    return { ok: false, error: `Could not read the workbook: ${(e as Error).message}` };
  }

  const supabase = await createClient();
  const { data } = await supabase.rpc("list_vendors");
  const approved = ((data ?? []) as Vendor[]).filter((v) => v.status === "approved");
  const byName = new Map(approved.map((v) => [v.name.toLowerCase().trim(), v.id]));

  const vendorMatches: VendorMatch[] = preview.vendorMatches.map((m) => ({
    name: m.name,
    vendor_id: byName.get(m.name.toLowerCase().trim()) ?? null,
  }));
  const unmatched = vendorMatches.filter((m) => !m.vendor_id).map((m) => m.name);
  const warnings = [...preview.warnings];
  if (unmatched.length > 0) {
    warnings.push(
      `These vendors aren't approved in the directory and will be skipped: ${unmatched.join(", ")}.`
    );
  }
  return { ok: true, preview: { ...preview, vendorMatches, warnings } };
}

/** Import one parsed package into a new comparison bound to a budget package. */
export async function commitComparisonImport(
  projectId: string,
  budgetPackageId: string,
  pkg: ComparisonImportPackage,
  vendorMatches: VendorMatch[]
): Promise<ActionResult> {
  if (!budgetPackageId) return fail("Pick the budget package this maps to.");
  const idByName = new Map(vendorMatches.filter((m) => m.vendor_id).map((m) => [m.name, m.vendor_id!]));
  const usedVendorIds = new Set<string>();

  const lines = pkg.lines.map((l) => ({
    ref: l.ref,
    description: l.description,
    unit: l.unit,
    qty: l.qty,
    quotes: l.quotes
      .filter((q) => idByName.has(q.vendor))
      .map((q) => {
        const vendor_id = idByName.get(q.vendor)!;
        usedVendorIds.add(vendor_id);
        return { vendor_id, rate: q.rate, make: q.make };
      }),
  }));
  if (usedVendorIds.size === 0) return fail("None of the sheet's vendors are approved in the directory.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("import_comparison", {
    p_project: projectId,
    p_package: budgetPackageId,
    p_title: pkg.name,
    p_vendors: [...usedVendorIds].map((vendor_id) => ({ vendor_id })),
    p_lines: lines,
  });
  if (error) return fail(error.message);
  await logAudit("procurement.comparison.import", `Imported comparison "${pkg.name}"`, { projectId });
  revalidatePath(`/projects/${projectId}/comparisons`);
  return { ok: true };
}
