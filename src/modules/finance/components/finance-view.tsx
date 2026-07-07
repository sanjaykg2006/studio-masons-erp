"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Coins, FileText, Receipt, ShieldCheck } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  BillingBranch,
  FinanceOrder,
  InvoiceDetail,
  InvoiceLine,
  InvoiceSummary,
  PaymentSummary,
  RetentionRow,
} from "@/modules/finance/types";
import { InvoiceTab } from "@/modules/finance/components/invoice-tab";
import { PaymentTab } from "@/modules/finance/components/payment-tab";
import { RetentionTab } from "@/modules/finance/components/retention-tab";
import { OrderAdvanceTab } from "@/modules/finance/components/order-advance-tab";

type Tab = "invoices" | "payments" | "retention" | "orders";

/** Accounts-approval seed data (detail + lines) for each pending-accounts invoice. */
export type ApproveSeed = Record<string, { detail: InvoiceDetail; lines: InvoiceLine[] }>;

export function FinanceView({
  projectId,
  projectName,
  invoices,
  payments,
  retention,
  orders,
  branches,
  approveSeed,
  canCreate,
}: {
  projectId: string;
  projectName: string;
  invoices: InvoiceSummary[];
  payments: PaymentSummary[];
  retention: RetentionRow[];
  orders: FinanceOrder[];
  branches: BillingBranch[];
  approveSeed: ApproveSeed;
  canCreate: boolean;
}) {
  const [tab, setTab] = useState<Tab>("invoices");

  const tabs: { id: Tab; label: string; icon: typeof Receipt; count: number }[] = [
    { id: "invoices", label: "Vendor invoices", icon: Receipt, count: invoices.length },
    { id: "payments", label: "Payment requests", icon: FileText, count: payments.length },
    { id: "retention", label: "Retention", icon: ShieldCheck, count: retention.length },
    { id: "orders", label: "POs & advances", icon: Coins, count: orders.length },
  ];

  return (
    <div className="space-y-6">
      <Link
        href={`/projects/${projectId}`}
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" /> {projectName}
      </Link>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
        <p className="text-muted-foreground">
          Vendor invoices, payment requests, advances and retention for this project.
        </p>
      </div>

      <div className="flex flex-wrap gap-1 border-b">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium",
                tab === t.id
                  ? "border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent"
              )}
            >
              <Icon className="size-4" /> {t.label}
              {t.count > 0 && <span className="text-muted-foreground text-xs">({t.count})</span>}
            </button>
          );
        })}
      </div>

      {tab === "invoices" && (
        <InvoiceTab
          projectId={projectId}
          invoices={invoices}
          orders={orders}
          approveSeed={approveSeed}
          canCreate={canCreate}
        />
      )}
      {tab === "payments" && <PaymentTab projectId={projectId} payments={payments} />}
      {tab === "retention" && <RetentionTab projectId={projectId} retention={retention} />}
      {tab === "orders" && (
        <OrderAdvanceTab projectId={projectId} orders={orders} branches={branches} />
      )}
    </div>
  );
}
