import { requirePermission } from "@/core/rbac/can";
import { getFinanceSummary, getInvoiceAgeing, getVendorOutstanding } from "@/modules/finance/data";
import { FinanceDashboard } from "@/modules/finance/components/finance-dashboard";

/** The company-wide Finance reports (all projects). */
export default async function FinanceReportsPage() {
  await requirePermission("finance.invoice", "read");

  const [summary, vendors, ageing] = await Promise.all([
    getFinanceSummary(),
    getVendorOutstanding(),
    getInvoiceAgeing(),
  ]);

  return <FinanceDashboard summary={summary} vendors={vendors} ageing={ageing} />;
}
