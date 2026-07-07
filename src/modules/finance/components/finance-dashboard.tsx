"use client";

import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  inr,
  type FinanceSummary,
  type InvoiceAgeing,
  type VendorOutstanding,
} from "@/modules/finance/types";

export function FinanceDashboard({
  summary,
  vendors,
  ageing,
}: {
  summary: FinanceSummary;
  vendors: VendorOutstanding[];
  ageing: InvoiceAgeing[];
}) {
  const exportTally = () => {
    const headers = [
      "Invoice No", "Vendor", "Project", "Base", "GST", "TDS",
      "Payable", "Paid", "Outstanding", "Approved On", "Due Date", "Days Due",
    ];
    const rows = ageing.map((a) => [
      a.invoice_no, a.vendor_name, a.project_name, a.base_value, a.gst_amount,
      a.tds_amount, a.amount_payable, a.paid, a.outstanding, a.approved_on,
      a.due_date ?? "", a.days_due,
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "finance-invoices.csv";
    a.click();
  };

  const tiles: { label: string; value: string; hint: string }[] = [
    { label: "Owed to vendors", value: inr(summary.total_owed), hint: "approved − paid" },
    { label: "Paid this month", value: inr(summary.paid_this_month), hint: "current month" },
    { label: "Advances unpaid", value: inr(summary.advances_unpaid), hint: "approved, not disbursed" },
    { label: "Retention held", value: inr(summary.retention_held), hint: "awaiting release" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Finance</h1>
          <p className="text-muted-foreground">Money owed, paid, advanced and held — across every project.</p>
        </div>
        <Button size="sm" variant="outline" onClick={exportTally} disabled={ageing.length === 0}>
          <Download className="size-4" /> Export (Tally CSV)
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <Card key={t.label}>
            <CardContent className="pt-6">
              <div className="text-muted-foreground text-xs font-medium uppercase">{t.label}</div>
              <div className="mt-1 text-2xl font-semibold">{t.value}</div>
              <div className="text-muted-foreground text-xs">{t.hint}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Vendor outstanding</CardTitle>
        </CardHeader>
        <CardContent>
          {vendors.length === 0 ? (
            <p className="text-muted-foreground text-sm">Nothing outstanding.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">Vendor</th>
                    <th className="py-2 font-medium">Invoiced</th>
                    <th className="py-2 font-medium">Paid</th>
                    <th className="py-2 font-medium">Retention</th>
                    <th className="py-2 font-medium">Outstanding</th>
                  </tr>
                </thead>
                <tbody>
                  {vendors.map((v) => (
                    <tr key={v.vendor_id} className="border-b last:border-0">
                      <td className="py-2 font-medium">{v.vendor_name}</td>
                      <td className="py-2">{inr(v.invoiced)}</td>
                      <td className="text-muted-foreground py-2">{inr(v.paid)}</td>
                      <td className="text-muted-foreground py-2">{inr(v.retention_held)}</td>
                      <td className="py-2 font-medium">{inr(v.outstanding)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Invoice ageing</CardTitle>
        </CardHeader>
        <CardContent>
          {ageing.length === 0 ? (
            <p className="text-muted-foreground text-sm">No approved invoices.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground border-b text-left">
                    <th className="py-2 font-medium">Invoice</th>
                    <th className="py-2 font-medium">Vendor</th>
                    <th className="py-2 font-medium">Project</th>
                    <th className="py-2 font-medium">Payable</th>
                    <th className="py-2 font-medium">Outstanding</th>
                    <th className="py-2 font-medium">Days due</th>
                  </tr>
                </thead>
                <tbody>
                  {ageing.map((a) => (
                    <tr key={a.invoice_no} className="border-b last:border-0">
                      <td className="py-2 font-medium">{a.invoice_no}</td>
                      <td className="text-muted-foreground py-2">{a.vendor_name}</td>
                      <td className="text-muted-foreground py-2">{a.project_name}</td>
                      <td className="py-2">{inr(a.amount_payable)}</td>
                      <td className="py-2">{inr(a.outstanding)}</td>
                      <td className="py-2">
                        <span className={a.days_due > 30 ? "text-destructive font-medium" : "text-muted-foreground"}>
                          {a.days_due}d
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
