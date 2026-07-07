import { notFound } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import { requireProjectPermission, canOnProject } from "@/core/rbac/can";
import {
  getInvoice,
  getInvoiceLines,
  listBillingBranches,
  listProjectFinanceOrders,
  listProjectInvoices,
  listProjectPayments,
  listProjectRetention,
} from "@/modules/finance/data";
import { FinanceView, type ApproveSeed } from "@/modules/finance/components/finance-view";

/** A project's Finance area — invoices, payments, retention, advances. */
export default async function ProjectFinancePage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "finance.invoice", "read");

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const [invoices, payments, retention, orders, branches, canCreate] = await Promise.all([
    listProjectInvoices(projectId),
    listProjectPayments(projectId),
    listProjectRetention(projectId),
    listProjectFinanceOrders(projectId),
    listBillingBranches(true),
    canOnProject(projectId, "finance.invoice", "create"),
  ]);

  // Preload the Accounts-booking seed (detail + lines) for invoices awaiting booking.
  const seedEntries = await Promise.all(
    invoices
      .filter((i) => i.status === "pending_accounts" && i.can_book)
      .map(async (i) => {
        const [detail, lines] = await Promise.all([getInvoice(i.id), getInvoiceLines(i.id)]);
        return detail ? ([i.id, { detail, lines }] as const) : null;
      })
  );
  const approveSeed: ApproveSeed = Object.fromEntries(
    seedEntries.filter((e): e is NonNullable<typeof e> => e !== null)
  );

  return (
    <FinanceView
      projectId={projectId}
      projectName={project.name as string}
      invoices={invoices}
      payments={payments}
      retention={retention}
      orders={orders}
      branches={branches}
      approveSeed={approveSeed}
      canCreate={canCreate}
    />
  );
}
