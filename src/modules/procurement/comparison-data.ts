import "server-only";

import { createClient } from "@/core/supabase/server";
import { canOnProject } from "@/core/rbac/can";
import type {
  ComparisonDetail,
  ComparisonLine,
  ComparisonSummary,
  ComparisonVendorRef,
  PackageRef,
  ProjectVendor,
  Vendor,
} from "@/modules/procurement/types";

/** The comparisons on a project (RLS-gated by procurement.comparison:read). */
export async function listProjectComparisons(projectId: string): Promise<ComparisonSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_comparisons", { p_project: projectId });
  return (data ?? []) as ComparisonSummary[];
}

/** The project's approved-vendor list. */
export async function listProjectVendors(projectId: string): Promise<ProjectVendor[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_project_vendors", { p_project: projectId });
  return (data ?? []) as ProjectVendor[];
}

/** Approved vendors from the global directory, for the "add vendor" pickers. */
export async function listApprovedVendors(): Promise<Vendor[]> {
  const supabase = await createClient();
  const { data } = await supabase.rpc("list_vendors");
  return ((data ?? []) as Vendor[]).filter((v) => v.status === "approved");
}

/** The released budget's packages, for the "new comparison" picker. */
export async function listReleasedPackages(projectId: string): Promise<PackageRef[]> {
  const supabase = await createClient();
  const { data: rel } = await supabase
    .from("procurement_budgets")
    .select("id")
    .eq("project_id", projectId)
    .eq("status", "released")
    .order("version_no", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!rel) return [];
  const { data: packages } = await supabase
    .from("procurement_budget_packages")
    .select("id, name")
    .eq("budget_id", (rel as { id: string }).id)
    .order("sort");
  return (packages ?? []) as PackageRef[];
}

type RawLine = {
  id: string;
  budget_line_id: string | null;
  description: string;
  unit: string | null;
  qty: number;
  sort: number;
  procurement_budget_lines: { rate: number } | null;
  procurement_comparison_quotes: { vendor_id: string; rate: number; make: string | null }[];
  procurement_comparison_awards: { vendor_id: string; qty: number; rate: number }[];
};

/** One comparison's full grid: its vendors, lines, quotes and awards. */
export async function getComparison(
  projectId: string,
  comparisonId: string
): Promise<ComparisonDetail | null> {
  const supabase = await createClient();

  const { data: header } = await supabase
    .from("procurement_comparisons")
    .select("id, project_id, title, status, awarded_at, awarded_by")
    .eq("id", comparisonId)
    .maybeSingle();
  if (!header || (header as { project_id: string }).project_id !== projectId) return null;
  const h = header as { id: string; title: string | null; status: "draft" | "awarded"; awarded_at: string | null; awarded_by: string | null };

  const [{ data: vendorRows }, { data: lineRows }, { data: pkgRow }, canEdit, canAward, approverName] =
    await Promise.all([
      supabase
        .from("procurement_comparison_vendors")
        .select("vendor_id, procurement_vendors(name)")
        .eq("comparison_id", comparisonId),
      supabase
        .from("procurement_comparison_lines")
        .select(
          "id, budget_line_id, description, unit, qty, sort, " +
            "procurement_budget_lines(rate), " +
            "procurement_comparison_quotes(vendor_id, rate, make), " +
            "procurement_comparison_awards(vendor_id, qty, rate)"
        )
        .eq("comparison_id", comparisonId)
        .order("sort"),
      supabase
        .from("procurement_comparisons")
        .select("procurement_budget_packages(name)")
        .eq("id", comparisonId)
        .maybeSingle(),
      canOnProject(projectId, "procurement.comparison", "create"),
      canOnProject(projectId, "procurement.comparison", "approve"),
      h.awarded_by
        ? supabase.from("profiles").select("full_name, email").eq("id", h.awarded_by).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const vendors: ComparisonVendorRef[] = (
    (vendorRows ?? []) as unknown as { vendor_id: string; procurement_vendors: { name: string } | null }[]
  ).map((v) => ({ vendor_id: v.vendor_id, name: v.procurement_vendors?.name ?? "Vendor" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const lines: ComparisonLine[] = ((lineRows ?? []) as unknown as RawLine[]).map((l) => ({
    id: l.id,
    budget_line_id: l.budget_line_id,
    description: l.description,
    unit: l.unit,
    qty: Number(l.qty),
    budget_rate: l.procurement_budget_lines ? Number(l.procurement_budget_lines.rate) : null,
    sort: l.sort,
    quotes: (l.procurement_comparison_quotes ?? []).map((q) => ({
      vendor_id: q.vendor_id,
      rate: Number(q.rate),
      make: q.make,
    })),
    award: (l.procurement_comparison_awards ?? [])[0]
      ? {
          vendor_id: l.procurement_comparison_awards[0].vendor_id,
          qty: Number(l.procurement_comparison_awards[0].qty),
          rate: Number(l.procurement_comparison_awards[0].rate),
        }
      : null,
  }));

  const pkgName =
    (pkgRow as { procurement_budget_packages: { name: string } | null } | null)
      ?.procurement_budget_packages?.name ?? null;
  const approver = (approverName as { data: { full_name: string | null; email: string } | null })?.data;

  return {
    id: h.id,
    title: h.title,
    status: h.status,
    package_name: pkgName,
    awarded_by_name: approver ? approver.full_name ?? approver.email : null,
    awarded_at: h.awarded_at,
    vendors,
    lines,
    canEdit,
    canAward,
  };
}
