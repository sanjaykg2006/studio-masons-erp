import Link from "next/link";
import { ArrowLeft } from "lucide-react";

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

  return (
    <div className="space-y-6">
      <Link
        href="/finance"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> Finance
      </Link>
      <FinanceDashboard summary={summary} vendors={vendors} ageing={ageing} />
    </div>
  );
}
