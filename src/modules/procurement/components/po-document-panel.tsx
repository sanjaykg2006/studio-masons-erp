"use client";

import { type ChangeEvent, type ReactNode, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, FileDown, Paperclip, Stamp } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { OrderDetail, OrderLine } from "@/modules/procurement/types";
import {
  BILLING_BRANCHES,
  DEFAULT_BILLING_BRANCH_ID,
  DEFAULT_NOTES,
  DEFAULT_PAYMENT_TERMS,
  NOTE_LABELS,
  NOTE_ORDER,
  billingBranch,
  variableRemarkRows,
} from "@/modules/procurement/po-terms";

type ProjectHeader = {
  name: string;
  code: string | null;
  client: string | null;
  location: string | null;
} | null;

const VARIABLE_ROWS = variableRemarkRows();
const initialRemarks = (): Record<string, string> =>
  Object.fromEntries(VARIABLE_ROWS.map((r) => [r.sl, r.defaultRemark]));

const fieldCls = "border-input bg-background w-full rounded-md border px-2 py-1.5 text-sm";
const labelCls = "text-muted-foreground mb-1 block text-xs font-medium";

/**
 * The "Generate PO document" panel. Reproduces the old project's generator form:
 * the standard Studio Masons details, notes, payment terms and annexure remarks are
 * pre-filled with the template defaults and fully editable per PO. Nothing here is
 * saved — these inputs only shape the downloaded PDF (matching the old behaviour).
 */
export function PoDocumentPanel({
  order,
  lines,
  project,
}: {
  order: OrderDetail;
  lines: OrderLine[];
  project: ProjectHeader;
}) {
  const [open, setOpen] = useState(false);
  const [branchId, setBranchId] = useState(DEFAULT_BILLING_BRANCH_ID);
  const [subject, setSubject] = useState("");
  const [quotationRef, setQuotationRef] = useState("");
  const [quotationDate, setQuotationDate] = useState("");
  const [vendorAddress, setVendorAddress] = useState("");
  const [vendorGstin, setVendorGstin] = useState("");
  const [commencement, setCommencement] = useState("");
  const [completion, setCompletion] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({ ...DEFAULT_NOTES });
  const [paymentTerms, setPaymentTerms] = useState(DEFAULT_PAYMENT_TERMS.join("\n"));
  const [annexRemarks, setAnnexRemarks] = useState<Record<string, string>>(initialRemarks);
  const [hsn, setHsn] = useState<Record<string, string>>({});
  const [sealDataUrl, setSealDataUrl] = useState<string | null>(null);
  const [sealName, setSealName] = useState("");
  const [annexureFile, setAnnexureFile] = useState<File | null>(null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showDetails, setShowDetails] = useState(true);
  const [showNotes, setShowNotes] = useState(false);
  const [showRemarks, setShowRemarks] = useState(false);

  const sealRef = useRef<HTMLInputElement>(null);
  const annexureRef = useRef<HTMLInputElement>(null);

  const setNote = (k: string, v: string) => setNotes((p) => ({ ...p, [k]: v }));

  const readSeal = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      setSealDataUrl(fr.result as string);
      setSealName(file.name);
    };
    fr.readAsDataURL(file);
  };

  // Builds the Studio Masons PO document from the order lines plus the details filled
  // in here, then downloads it. The heavy PDF libraries load on demand.
  const generate = async () => {
    if (!order.po_number) return;
    setError(null);
    setGenerating(true);
    try {
      const { generatePoPdf } = await import("@/modules/procurement/po-document");
      const branch = billingBranch(branchId);
      const paymentTermsLines = paymentTerms
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      await generatePoPdf({
        poNumber: order.po_number,
        date: order.issued_at ?? new Date().toISOString(),
        projectName: project?.name ?? "",
        projectCode: project?.code ?? undefined,
        clientName: project?.client ?? undefined,
        location: project?.location ?? undefined,
        vendorName: order.vendor_name,
        vendorAddress: vendorAddress.trim() || undefined,
        vendorGstin: vendorGstin.trim() || undefined,
        subject: subject.trim() || undefined,
        quotationRef: quotationRef.trim() || undefined,
        quotationDate: quotationDate || undefined,
        billingLines: branch.billingLines,
        notes,
        paymentTermsLines: paymentTermsLines.length ? paymentTermsLines : undefined,
        lines: lines.map((l) => ({
          service: l.description,
          unit: l.unit ?? "—",
          quantity: l.qty_ordered,
          rate: l.rate,
          amount: l.qty_ordered * l.rate,
          hsn: hsn[l.id]?.trim() || undefined,
        })),
        poValue: lines.reduce((s, l) => s + l.qty_ordered * l.rate, 0),
        commencement: commencement || undefined,
        completion: completion || undefined,
        annexRemarks,
        sealDataUrl: sealDataUrl ?? undefined,
        annexureFile: annexureFile ?? undefined,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not generate the PO document.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="bg-muted/30 mb-2 rounded-md border px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm">
          <p className="font-medium">Generate PO document</p>
          <p className="text-muted-foreground text-xs">
            Builds the Studio Masons purchase order — with terms &amp; annexure — from these order
            lines. The details below are optional and pre-filled with the standard template.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide details" : "Edit details"}
          </Button>
          <Button size="sm" disabled={generating} onClick={generate}>
            <FileDown className="size-4" /> {generating ? "Generating…" : "Generate"}
          </Button>
        </div>
      </div>

      {error && <p className="text-destructive mt-2 text-sm">{error}</p>}

      {open && (
        <div className="mt-3 space-y-3 border-t pt-3">
          {/* Billing branch — the one field that affects the printed GSTIN. */}
          <div className="sm:w-2/3">
            <label className={labelCls}>Billing address (GST branch)</label>
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className={fieldCls}
              aria-label="Billing branch"
            >
              {BILLING_BRANCHES.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label} · {b.gstin}
                </option>
              ))}
            </select>
          </div>

          {/* PO document details ------------------------------------------------ */}
          <Section label="Vendor, dates & seal" open={showDetails} onToggle={() => setShowDetails((s) => !s)}>
            <Field label="Subject">
              <Input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={project ? `Purchase order for ${project.name}` : "Subject"}
                className="h-9"
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Quotation reference">
                <Input value={quotationRef} onChange={(e) => setQuotationRef(e.target.value)} placeholder="Quotation no. / ref" className="h-9" />
              </Field>
              <Field label="Quotation date">
                <input type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} className={fieldCls} aria-label="Quotation date" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Vendor address">
                <textarea
                  value={vendorAddress}
                  onChange={(e) => setVendorAddress(e.target.value)}
                  rows={3}
                  placeholder={"No: 45, Garden Street\nRamamurthynagar\nBengaluru - 560016"}
                  className={cn(fieldCls, "resize-y")}
                />
              </Field>
              <Field label="Vendor GSTIN">
                <Input value={vendorGstin} onChange={(e) => setVendorGstin(e.target.value)} placeholder="29ABCDE1234F1Z5" className="h-9" />
              </Field>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Work commencement">
                <input type="date" value={commencement} onChange={(e) => setCommencement(e.target.value)} className={fieldCls} aria-label="Work commencement" />
              </Field>
              <Field label="Work completion">
                <input type="date" value={completion} onChange={(e) => setCompletion(e.target.value)} className={fieldCls} aria-label="Work completion" />
              </Field>
            </div>

            {/* Per-line HSN / SAC codes (only shown on the document, not stored). */}
            <div>
              <label className={labelCls}>HSN / SAC code per line</label>
              <div className="space-y-1.5">
                {lines.map((l) => (
                  <div key={l.id} className="grid grid-cols-[1fr_120px] items-center gap-2">
                    <span className="truncate text-sm">{l.description}</span>
                    <Input
                      value={hsn[l.id] ?? ""}
                      onChange={(e) => setHsn((p) => ({ ...p, [l.id]: e.target.value }))}
                      placeholder="HSN/SAC"
                      className="h-8"
                      aria-label={`HSN for ${l.description}`}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className={labelCls}>Seal &amp; signature (image)</label>
                <input ref={sealRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={readSeal} aria-label="Seal and signature" />
                <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={() => sealRef.current?.click()}>
                  {sealDataUrl ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Stamp className="size-4" />}
                  <span className="truncate">{sealName || "Upload seal & sign"}</span>
                </Button>
              </div>
              <div>
                <label className={labelCls}>Annexure attachment (optional)</label>
                <input ref={annexureRef} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => setAnnexureFile(e.target.files?.[0] ?? null)} aria-label="Annexure attachment" />
                <Button type="button" variant="outline" size="sm" className="w-full justify-start" onClick={() => annexureRef.current?.click()}>
                  {annexureFile ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Paperclip className="size-4" />}
                  <span className="truncate">{annexureFile?.name || "Attach annexure (PDF/image)"}</span>
                </Button>
              </div>
            </div>
          </Section>

          {/* Editable notes 1–11 + payment terms -------------------------------- */}
          <Section label="Notes & payment terms (1–11)" open={showNotes} onToggle={() => setShowNotes((s) => !s)}>
            {NOTE_ORDER.map((k) =>
              k === "5" ? (
                <div key={k} className="space-y-2">
                  <Field label={`5 · ${NOTE_LABELS["5"]}`}>
                    <Input value={notes["5"] ?? ""} onChange={(e) => setNote("5", e.target.value)} className="h-9" />
                  </Field>
                  <div className="border-muted border-l-2 pl-3">
                    <Field label="Payment terms (a, b, c… — one per line)">
                      <textarea
                        value={paymentTerms}
                        onChange={(e) => setPaymentTerms(e.target.value)}
                        rows={4}
                        placeholder={DEFAULT_PAYMENT_TERMS.join("\n")}
                        className={cn(fieldCls, "resize-y leading-relaxed")}
                      />
                    </Field>
                  </div>
                </div>
              ) : (
                <Field key={k} label={`${k} · ${NOTE_LABELS[k]}`}>
                  {k === "4" ? (
                    <textarea value={notes[k] ?? ""} onChange={(e) => setNote(k, e.target.value)} rows={3} className={cn(fieldCls, "resize-y")} />
                  ) : (
                    <Input value={notes[k] ?? ""} onChange={(e) => setNote(k, e.target.value)} className="h-9" />
                  )}
                </Field>
              )
            )}
          </Section>

          {/* Editable annexure remarks ------------------------------------------ */}
          <Section label="Annexure remarks" open={showRemarks} onToggle={() => setShowRemarks((s) => !s)}>
            <div className="space-y-2">
              {VARIABLE_ROWS.map((row) => (
                <div key={row.sl} className="grid grid-cols-[1fr_160px] items-center gap-2">
                  <label className="text-sm" htmlFor={`annex-${row.sl}`}>
                    <span className="text-muted-foreground mr-1.5 font-medium">{row.sl}.</span>
                    {row.title}
                  </label>
                  <Input
                    id={`annex-${row.sl}`}
                    value={annexRemarks[row.sl] ?? ""}
                    onChange={(e) => setAnnexRemarks((p) => ({ ...p, [row.sl]: e.target.value }))}
                    placeholder={row.defaultRemark || "Remark"}
                    className="h-8"
                  />
                </div>
              ))}
            </div>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-sm font-medium"
      >
        <ChevronRight className={cn("size-4 transition-transform", open && "rotate-90")} />
        <span>{label}</span>
      </button>
      {open && <div className="space-y-3 border-t px-3 py-3">{children}</div>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}
