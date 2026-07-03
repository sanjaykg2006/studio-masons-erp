"use client";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { useProject, type VendorPO } from "../../../contexts/ProjectContext";
import { useToast } from "@/lib/toast";
import { PoLinesEditor, buildPoLines, inr, emptyLine, type DraftLine } from "./PoLinesEditor";
import { parseBoqFile } from "./boqParser";
import { generatePoPdf } from "./poDocument";
import { DEFAULT_PAYMENT_TERMS, DEFAULT_NOTES, NOTE_ORDER, NOTE_LABELS, variableRemarkRows, BILLING_BRANCHES, DEFAULT_BILLING_BRANCH_ID, billingBranch } from "./poTerms";
import { loadCurrentUser } from "../data";
import { uploadFileToStorage, openDocument, isStored } from "../docs";
import BudgetBoqTab from "./BudgetBoqTab";
import IntentsTab from "./IntentsTab";
import ComparisonTab from "./ComparisonTab";

// The procurement → finance pipeline stages, shown as tabs. The PO generator is the
// final stage (now fed by an approved intent's chosen vendor BOQ).
const PROC_TABS = [
  { id: "budget", label: "Budget BOQ", icon: "menu_book" },
  { id: "intents", label: "Purchase Intents", icon: "playlist_add_check" },
  { id: "comparison", label: "Quote Comparison", icon: "table_chart" },
  { id: "generator", label: "PO Generator", icon: "request_quote" },
] as const;
type ProcTab = (typeof PROC_TABS)[number]["id"];

const VARIABLE_ROWS = variableRemarkRows();
const initialRemarks = () => Object.fromEntries(VARIABLE_ROWS.map((r) => [r.sl, r.defaultRemark]));

const labelStyle: React.CSSProperties = { fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", color: "#999999", marginBottom: "6px", display: "block" };
const inputStyle: React.CSSProperties = { width: "100%", padding: "10px 12px", border: "1px solid #e4e2e1", borderRadius: "8px", fontSize: "13px", color: "#333333", background: "white", boxSizing: "border-box" };

// Field label with a red asterisk — every form field is required except the BOQ
// upload and the optional annexure attachment.
function ReqLabel({ children }: { children: ReactNode }) {
  return <label style={labelStyle}>{children}<span style={{ color: "#e30613" }}> *</span></label>;
}

export default function PurchaseOrdersPage() {
  const { selectedProject, vendorPOs, addVendorPO, removeVendorPO, acceptVendorPO, approveAdvance } = useProject();
  const toast = useToast();

  // Active procurement-pipeline tab and the logged-in user's role (for gating the
  // stage actions; the real enforcement lives in the server actions via requireRole).
  const [tab, setTab] = useState<ProcTab>("budget");
  const [role, setRole] = useState<string>("");
  useEffect(() => { loadCurrentUser().then((u) => setRole(u?.role ?? "")).catch(() => setRole("")); }, []);

  // When set, the form is amending an existing PO rather than creating a new one.
  const [amendingId, setAmendingId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Acceptance + advance flows, moved here from the dashboard.
  const [acceptanceId, setAcceptanceId] = useState<string | null>(null);
  const [acceptFile, setAcceptFile] = useState<File | null>(null);
  const [acceptAdvance, setAcceptAdvance] = useState("");
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [advanceTdsPct, setAdvanceTdsPct] = useState(2);
  const acceptRef = useRef<HTMLInputElement>(null);

  const [vendorName, setVendorName] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [fixedContract, setFixedContract] = useState(false);
  const [contractStart, setContractStart] = useState("");
  const [contractEnd, setContractEnd] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([{ ...emptyLine }]);
  const [importing, setImporting] = useState(false);
  const boqRef = useRef<HTMLInputElement>(null);

  // Extra details that appear on the generated PO document (not persisted — they
  // shape the PDF only). Defaults match the Studio Masons template.
  const [showDetails, setShowDetails] = useState(false);
  // Which Studio Masons GST branch the PO is billed from (head office by default).
  const [billingBranchId, setBillingBranchId] = useState(DEFAULT_BILLING_BRANCH_ID);
  const [subject, setSubject] = useState("");
  const [quotationRef, setQuotationRef] = useState("");
  const [quotationDate, setQuotationDate] = useState("");
  const [vendorAddress, setVendorAddress] = useState("");
  const [vendorGstin, setVendorGstin] = useState("");
  const [commencement, setCommencement] = useState("");
  const [completion, setCompletion] = useState("");
  // Page-1 notes/terms — every line is user-editable, prefilled with the standard text.
  const [showNotes, setShowNotes] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({ ...DEFAULT_NOTES });
  const [paymentTerms, setPaymentTerms] = useState(DEFAULT_PAYMENT_TERMS.join("\n"));
  // Annexure remarks for the variable rows, keyed by Sl No.
  const [showRemarks, setShowRemarks] = useState(false);
  const [annexRemarks, setAnnexRemarks] = useState<Record<string, string>>(initialRemarks);
  // Seal + signature image and an optional annexure document to append.
  const [sealDataUrl, setSealDataUrl] = useState<string | null>(null);
  const [sealName, setSealName] = useState("");
  const [annexureFile, setAnnexureFile] = useState<File | null>(null);
  const sealRef = useRef<HTMLInputElement>(null);
  const annexureRef = useRef<HTMLInputElement>(null);

  // The PO is always raised for the project selected in the top bar.
  const projectId = selectedProject?.id ?? "";
  const listed = vendorPOs.filter((po) => po.projectId === projectId);

  const setNote = (k: string, v: string) => setNotes((prev) => ({ ...prev, [k]: v }));

  // Import: read the uploaded BOQ workbook and populate the service line items.
  async function importBoq(file: File) {
    setImporting(true);
    try {
      const parsed = await parseBoqFile(file);
      setLines(parsed);
      toast.success("BOQ imported", `${parsed.length} line item${parsed.length === 1 ? "" : "s"} read from ${file.name}.`);
    } catch (err) {
      toast.warning("Couldn't read the BOQ", err instanceof Error ? err.message : "The file couldn't be parsed.");
    } finally {
      setImporting(false);
      if (boqRef.current) boqRef.current.value = "";
    }
  }

  // Read the seal/signature image into a data URL so it can be embedded in the PDF.
  function readSeal(file: File) {
    const fr = new FileReader();
    fr.onload = () => { setSealDataUrl(fr.result as string); setSealName(file.name); };
    fr.readAsDataURL(file);
  }

  // Clears the form back to a fresh, blank PO.
  function resetForm() {
    setAmendingId(null);
    setVendorName(""); setPoNumber("");
    setFixedContract(false); setContractStart(""); setContractEnd("");
    setLines([{ ...emptyLine }]);
    setBillingBranchId(DEFAULT_BILLING_BRANCH_ID);
    setSubject(""); setQuotationRef(""); setQuotationDate("");
    setVendorAddress(""); setVendorGstin(""); setCommencement(""); setCompletion("");
    setNotes({ ...DEFAULT_NOTES });
    setPaymentTerms(DEFAULT_PAYMENT_TERMS.join("\n"));
    setAnnexRemarks(initialRemarks());
    setSealDataUrl(null); setSealName(""); setAnnexureFile(null);
    if (sealRef.current) sealRef.current.value = "";
    if (annexureRef.current) annexureRef.current.value = "";
  }

  // Load an existing PO's stored details into the form for editing.
  function startAmend(po: VendorPO) {
    setAmendingId(po.id);
    setVendorName(po.vendorName);
    setPoNumber(po.poNumber);
    setSubject(po.subject ?? "");
    setQuotationRef(po.quotationRef ?? "");
    setQuotationDate(po.quotationDate ?? "");
    setVendorAddress(po.vendorAddress ?? "");
    setVendorGstin(po.vendorGstin ?? "");
    setBillingBranchId(po.billingBranchId ?? DEFAULT_BILLING_BRANCH_ID);
    setCommencement(po.commencement ?? "");
    setCompletion(po.completion ?? "");
    setNotes({ ...DEFAULT_NOTES, ...(po.notes ?? {}) });
    setPaymentTerms((po.paymentTerms && po.paymentTerms.length ? po.paymentTerms : DEFAULT_PAYMENT_TERMS).join("\n"));
    setAnnexRemarks({ ...initialRemarks(), ...(po.annexRemarks ?? {}) });
    setFixedContract(!!po.fixedContract);
    setContractStart(po.contractStart ?? "");
    setContractEnd(po.contractEnd ?? "");
    setLines(po.lines && po.lines.length
      ? po.lines.map((l) => ({ service: l.service, unit: l.unit === "—" ? "" : l.unit, quantity: String(l.quantity), rate: String(l.rate), hsn: "" }))
      : [{ ...emptyLine }]);
    setSealDataUrl(null); setSealName(""); setAnnexureFile(null);
    setShowDetails(true); setShowNotes(true); setShowRemarks(true);
    formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Delete an existing PO (with confirmation). Clears the form if it was being amended.
  function handleDeletePO(po: VendorPO) {
    if (!confirm(`Delete the purchase order for ${po.vendorName}? This removes the PO and its line items and cannot be undone.`)) return;
    removeVendorPO({ projectId: po.projectId, vendorName: po.vendorName });
    if (amendingId === po.id) resetForm();
    toast.success("Purchase order deleted", `${po.vendorName} — ${po.poNumber} removed from ${po.projectName ?? selectedProject?.name ?? "the project"}.`);
  }

  // Acceptance — record the document + requested advance against a PO. The signed
  // acceptance document is uploaded to storage so it stays retrievable later.
  async function submitAcceptance() {
    const po = vendorPOs.find((v) => v.id === acceptanceId);
    if (!po) return;
    const adv = Number(acceptAdvance);
    if (!acceptFile || !(adv > 0) || adv > po.poValue) {
      toast.warning("Missing details", "Attach the acceptance document and enter an advance within the PO value.");
      return;
    }
    try {
      const path = await uploadFileToStorage(acceptFile, "po-acceptance");
      acceptVendorPO({ projectId: po.projectId, vendorName: po.vendorName, acceptanceFileName: path, advanceRequested: adv });
      toast.success("Acceptance recorded", `${po.vendorName} accepted — advance of ₹${adv.toLocaleString("en-IN")} pending approval.`);
      setAcceptanceId(null); setAcceptFile(null); setAcceptAdvance("");
    } catch (err) {
      toast.warning("Couldn't upload acceptance", err instanceof Error ? err.message : "Try again.");
    }
  }

  // Accounts approves the advance with a TDS %.
  function submitApproveAdvance() {
    const po = vendorPOs.find((v) => v.id === approvingId);
    if (!po) return;
    approveAdvance({ projectId: po.projectId, vendorName: po.vendorName, tdsPct: advanceTdsPct });
    const payable = (po.advanceRequested ?? 0) * (1 - advanceTdsPct / 100);
    toast.success("Advance approved", `${po.vendorName}: ₹${payable.toLocaleString("en-IN")} payable after ${advanceTdsPct}% TDS.`);
    setApprovingId(null); setAdvanceTdsPct(2);
  }

  async function generate() {
    if (!selectedProject) {
      toast.warning("Select a project", "Choose the project from the top bar before raising a purchase order.");
      return;
    }

    const paymentTermsLines = paymentTerms.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const { poLines, poValue } = buildPoLines(lines);

    // Everything is required except the BOQ upload and the annexure attachment.
    const missing: string[] = [];
    const need = (v: string, label: string) => { if (!v.trim()) missing.push(label); };
    need(vendorName, "Vendor");
    need(poNumber, "PO Number");
    need(subject, "Subject");
    need(quotationRef, "Quotation reference");
    need(quotationDate, "Quotation date");
    need(vendorAddress, "Vendor address");
    need(vendorGstin, "Vendor GSTIN");
    need(commencement, "Work commencement");
    need(completion, "Work completion");
    if (paymentTermsLines.length === 0) missing.push("Billing & Payment Terms");
    if (!sealDataUrl) missing.push("Seal & signature");
    NOTE_ORDER.forEach((k) => need(notes[k] ?? "", `Note ${k} (${NOTE_LABELS[k]})`));
    VARIABLE_ROWS.forEach((r) => need(annexRemarks[r.sl] ?? "", `Annexure remark ${r.sl}`));
    if (poLines.length === 0) missing.push("At least one service line");

    if (missing.length) {
      setShowDetails(true); setShowNotes(true); setShowRemarks(true);
      toast.warning(
        `Missing ${missing.length} required field${missing.length === 1 ? "" : "s"}`,
        missing.slice(0, 5).join(", ") + (missing.length > 5 ? `, +${missing.length - 5} more` : ""),
      );
      return;
    }

    const trimmedPo = poNumber.trim();
    const trimmedVendor = vendorName.trim();

    addVendorPO({
      projectId: selectedProject.id,
      vendorName: trimmedVendor,
      poNumber: trimmedPo,
      poValue,
      poFileName: `${trimmedPo}_${trimmedVendor}.pdf`,
      subject: subject.trim(),
      quotationRef: quotationRef.trim(),
      quotationDate,
      vendorAddress: vendorAddress.trim(),
      vendorGstin: vendorGstin.trim(),
      billingBranchId,
      commencement,
      completion,
      paymentTerms: paymentTermsLines,
      notes,
      annexRemarks,
      fixedContract,
      contractStart: fixedContract ? contractStart || undefined : undefined,
      contractEnd: fixedContract ? contractEnd || undefined : undefined,
      lines: poLines,
    });

    // Generate and download the PO document in the Studio Masons format.
    await generatePoPdf({
      poNumber: trimmedPo,
      date: new Date().toISOString().slice(0, 10),
      projectName: selectedProject.name,
      clientName: selectedProject.clientName,
      location: selectedProject.location,
      vendorName: trimmedVendor,
      vendorAddress: vendorAddress.trim(),
      vendorGstin: vendorGstin.trim(),
      subject: subject.trim(),
      quotationRef: quotationRef.trim(),
      quotationDate,
      billingLines: billingBranch(billingBranchId).billingLines,
      notes,
      paymentTermsLines,
      lines: poLines,
      poValue,
      commencement,
      completion,
      annexRemarks,
      sealDataUrl: sealDataUrl ?? undefined,
      annexureFile: annexureFile ?? undefined,
    });

    toast.success(
      amendingId ? "Purchase order amended" : "Purchase order generated",
      `${trimmedVendor} — ${trimmedPo} for ${inr(poValue)} on ${selectedProject.name}. PDF downloaded.`,
    );

    // Reset for the next PO on the same project.
    resetForm();
  }

  const sectionToggle: React.CSSProperties = { display: "flex", alignItems: "center", gap: "6px", border: "none", background: "none", color: "#333333", fontSize: "12px", fontWeight: "bold", padding: 0, marginBottom: "12px", cursor: "pointer" };
  const chevron = (open: boolean): React.CSSProperties => ({ fontSize: "18px", transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" });
  const sectionBox: React.CSSProperties = { border: "1px solid #f0eeed", borderRadius: "8px", padding: "16px", marginBottom: "20px", display: "flex", flexDirection: "column", gap: "14px" };
  const poActionStyle = (color: string): React.CSSProperties => ({ display: "inline-flex", alignItems: "center", gap: "4px", border: `1px solid ${color}`, borderRadius: "6px", background: "white", color, fontSize: "11px", fontWeight: "bold", padding: "5px 10px", cursor: "pointer" });
  const modalOverlay: React.CSSProperties = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" };
  const modalCard: React.CSSProperties = { background: "white", borderRadius: "12px", width: "100%", maxWidth: "440px", margin: "16px", overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" };
  const modalHeader: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 24px", borderBottom: "1px solid #e4e2e1" };
  const modalFooter: React.CSSProperties = { padding: "16px 24px", borderTop: "1px solid #e4e2e1", background: "#f8f8f8", display: "flex", justifyContent: "flex-end", gap: "10px" };
  const modalCancelBtn: React.CSSProperties = { padding: "8px 20px", border: "1px solid #e4e2e1", borderRadius: "6px", background: "white", color: "#333333", fontWeight: "bold", cursor: "pointer", fontSize: "13px" };
  const modalPrimaryBtn: React.CSSProperties = { padding: "8px 24px", border: "none", borderRadius: "6px", background: "#e30613", color: "white", fontWeight: "bold", cursor: "pointer", fontSize: "13px" };

  return (
    <div>
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 mb-6 text-[#666666] text-[10px] font-bold uppercase tracking-wider">
        <span>Dashboard</span>
        <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>chevron_right</span>
        <span className="text-[#e30613]">Purchase Orders</span>
      </nav>

      {/* Procurement-pipeline tabs */}
      <div style={{ display: "flex", gap: "4px", borderBottom: "1px solid #e4e2e1", marginBottom: "28px", flexWrap: "wrap" }}>
        {PROC_TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ display: "flex", alignItems: "center", gap: "6px", border: "none", background: "none", padding: "10px 14px", cursor: "pointer", fontSize: "13px", fontWeight: "bold", color: tab === t.id ? "#e30613" : "#666666", borderBottom: `2px solid ${tab === t.id ? "#e30613" : "transparent"}`, marginBottom: "-1px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>{t.icon}</span>
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "generator" && !selectedProject && (
        <div style={{ background: "white", border: "1px solid #e4e2e1", borderRadius: "12px", padding: "48px 24px", textAlign: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "40px", color: "#cccccc" }}>folder_open</span>
          <h3 style={{ fontSize: "16px", fontWeight: "bold", color: "#333333", marginTop: "12px" }}>Select a project first</h3>
          <p style={{ fontSize: "13px", color: "#999999", marginTop: "6px" }}>Use the project selector in the top bar to choose the project.</p>
        </div>
      )}
      {tab === "budget" && selectedProject && <BudgetBoqTab projectId={selectedProject.id} projectName={selectedProject.name} role={role} />}
      {tab === "intents" && selectedProject && <IntentsTab projectId={selectedProject.id} projectName={selectedProject.name} role={role} />}
      {tab === "comparison" && selectedProject && <ComparisonTab projectId={selectedProject.id} projectName={selectedProject.name} role={role} />}

      {tab === "generator" && (<>
      <h2 className="text-[32px] font-bold text-[#333333] mb-2">Generate Purchase Order</h2>
      <p style={{ fontSize: "16px", color: "#666666", marginBottom: "32px", maxWidth: "560px", lineHeight: 1.6 }}>
        Raising a PO for{" "}
        <strong style={{ color: "#333333" }}>{selectedProject ? selectedProject.name : "the selected project"}</strong>.
        Import a BOQ to read in the line items automatically, or enter them by hand — then generate
        the purchase-order document as a downloadable PDF.
      </p>

      {!selectedProject ? (
        <div style={{ background: "white", border: "1px solid #e4e2e1", borderRadius: "12px", padding: "48px 24px", textAlign: "center" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "40px", color: "#cccccc" }}>folder_open</span>
          <h3 style={{ fontSize: "16px", fontWeight: "bold", color: "#333333", marginTop: "12px" }}>Select a project first</h3>
          <p style={{ fontSize: "13px", color: "#999999", marginTop: "6px" }}>
            Use the project selector in the top bar to choose the project this purchase order belongs to.
          </p>
        </div>
      ) : (
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: "24px", alignItems: "start" }}>
        {/* ── Generator form ─────────────────────────────────────── */}
        <div ref={formRef} style={{ background: "white", border: "1px solid #e4e2e1", borderRadius: "12px", padding: "24px" }}>
          {amendingId && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "16px", padding: "10px 14px", borderRadius: "8px", background: "rgba(227,6,19,0.06)", border: "1px solid rgba(227,6,19,0.2)" }}>
              <span style={{ fontSize: "12px", fontWeight: "bold", color: "#e30613", display: "flex", alignItems: "center", gap: "6px" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>edit_note</span>
                Amending {poNumber || "purchase order"} — re-upload the seal to regenerate.
              </span>
              <button type="button" onClick={resetForm} style={{ border: "none", background: "none", color: "#666666", fontSize: "11px", fontWeight: "bold", cursor: "pointer", textTransform: "uppercase" }}>Cancel</button>
            </div>
          )}
          {/* Vendor + PO number */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
            <div>
              <ReqLabel>Vendor</ReqLabel>
              <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} placeholder="e.g. Blackwood Stonemasons Ltd." style={inputStyle} />
            </div>
            <div>
              <ReqLabel>PO Number</ReqLabel>
              <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="2025-26/PO/WORK/…" style={inputStyle} />
            </div>
          </div>

          {/* BOQ import (optional) */}
          <div style={{ marginBottom: "20px", background: "#f8f8f8", border: "1px dashed #d4d2d1", borderRadius: "8px", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <div>
              <div style={{ fontSize: "13px", fontWeight: "bold", color: "#333333" }}>Import from BOQ <span style={{ color: "#bbbbbb", fontWeight: "normal" }}>(optional)</span></div>
              <div style={{ fontSize: "11px", color: "#999999", marginTop: "2px" }}>
                Upload an Excel BOQ (.xlsx) — line items, HSN, units and rates are read in automatically.
              </div>
            </div>
            <input ref={boqRef} type="file" accept=".xlsx,.xls" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) importBoq(f); }} />
            <button type="button" onClick={() => boqRef.current?.click()} disabled={importing}
              style={{ display: "flex", alignItems: "center", gap: "6px", border: "1px solid #e4e2e1", borderRadius: "8px", background: "white", color: "#333333", fontSize: "12px", fontWeight: "bold", padding: "9px 14px", cursor: importing ? "wait" : "pointer", whiteSpace: "nowrap" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>upload_file</span>
              {importing ? "Reading…" : "Upload BOQ"}
            </button>
          </div>

          {/* Service line items */}
          <ReqLabel>Services</ReqLabel>
          <div style={{ marginBottom: "20px" }}>
            <PoLinesEditor lines={lines} setLines={setLines} showHsn />
          </div>

          {/* PO document details (collapsible) */}
          <button type="button" onClick={() => setShowDetails((s) => !s)} style={sectionToggle}>
            <span className="material-symbols-outlined" style={chevron(showDetails)}>chevron_right</span>
            PO document details {showDetails ? "" : "(vendor address, GSTIN, dates, seal)"}
          </button>

          {showDetails && (
            <div style={sectionBox}>
              <div>
                <ReqLabel>Billing address (GST branch)</ReqLabel>
                <select value={billingBranchId} onChange={(e) => setBillingBranchId(e.target.value)} style={inputStyle}>
                  {BILLING_BRANCHES.map((b) => (
                    <option key={b.id} value={b.id}>{b.label} · {b.gstin}</option>
                  ))}
                </select>
              </div>
              <div>
                <ReqLabel>Subject</ReqLabel>
                <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={`Purchase order for ${selectedProject.name}`} style={inputStyle} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <ReqLabel>Quotation reference</ReqLabel>
                  <input value={quotationRef} onChange={(e) => setQuotationRef(e.target.value)} placeholder="Quotation no. / ref" style={inputStyle} />
                </div>
                <div>
                  <ReqLabel>Quotation date</ReqLabel>
                  <input type="date" value={quotationDate} onChange={(e) => setQuotationDate(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <ReqLabel>Vendor address</ReqLabel>
                  <textarea value={vendorAddress} onChange={(e) => setVendorAddress(e.target.value)} rows={3} placeholder={"No: 45 Pankaja Nilaya, Garden Street\nRamamurthynagar\nBengaluru - 560016"} style={{ ...inputStyle, resize: "vertical" }} />
                </div>
                <div>
                  <ReqLabel>Vendor GSTIN</ReqLabel>
                  <input value={vendorGstin} onChange={(e) => setVendorGstin(e.target.value)} placeholder="29FZTPD8553E1ZR" style={inputStyle} />
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <ReqLabel>Work commencement</ReqLabel>
                  <input type="date" value={commencement} onChange={(e) => setCommencement(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <ReqLabel>Work completion</ReqLabel>
                  <input type="date" value={completion} onChange={(e) => setCompletion(e.target.value)} style={inputStyle} />
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                <div>
                  <ReqLabel>Seal &amp; signature (image)</ReqLabel>
                  <input ref={sealRef} type="file" accept="image/png,image/jpeg" hidden
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) readSeal(f); }} />
                  <button type="button" onClick={() => sealRef.current?.click()}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "6px", border: `1px solid ${sealDataUrl ? "#16a34a" : "#e4e2e1"}`, borderRadius: "8px", background: "white", color: "#333333", fontSize: "12px", fontWeight: "bold", padding: "9px 12px", cursor: "pointer" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: "16px", color: sealDataUrl ? "#16a34a" : "#666666" }}>{sealDataUrl ? "check_circle" : "approval"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sealName || "Upload seal & sign"}</span>
                  </button>
                </div>
                <div>
                  <label style={labelStyle}>Annexure scope <span style={{ color: "#bbbbbb" }}>(optional)</span></label>
                  <input ref={annexureRef} type="file" accept="application/pdf,image/png,image/jpeg" hidden
                    onChange={(e) => setAnnexureFile(e.target.files?.[0] ?? null)} />
                  <button type="button" onClick={() => annexureRef.current?.click()}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "6px", border: "1px solid #e4e2e1", borderRadius: "8px", background: "white", color: "#333333", fontSize: "12px", fontWeight: "bold", padding: "9px 12px", cursor: "pointer" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>{annexureFile ? "check_circle" : "attach_file"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{annexureFile?.name || "Attach annexure (PDF/image)"}</span>
                  </button>
                </div>
              </div>
              <p style={{ fontSize: "10px", color: "#bbbbbb", marginTop: "-6px" }}>Supply &amp; installation annexure is appended after the PO &amp; terms in the downloaded document.</p>
            </div>
          )}

          {/* Editable page-1 notes & terms */}
          <button type="button" onClick={() => setShowNotes((s) => !s)} style={sectionToggle}>
            <span className="material-symbols-outlined" style={chevron(showNotes)}>chevron_right</span>
            PO notes &amp; terms (1–11) {showNotes ? "" : "— editable"}
          </button>

          {showNotes && (
            <div style={sectionBox}>
              {NOTE_ORDER.map((k) => (
                k === "5" ? (
                  <div key={k} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div>
                      <ReqLabel>5 · {NOTE_LABELS["5"]}</ReqLabel>
                      <input value={notes["5"] ?? ""} onChange={(e) => setNote("5", e.target.value)} style={inputStyle} />
                    </div>
                    <div style={{ paddingLeft: "16px", borderLeft: "2px solid #f0eeed" }}>
                      <ReqLabel>Payment terms (a, b, c… — one per line)</ReqLabel>
                      <textarea value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value)} rows={4}
                        placeholder={DEFAULT_PAYMENT_TERMS.join("\n")} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
                    </div>
                  </div>
                ) : (
                  <div key={k}>
                    <ReqLabel>{k} · {NOTE_LABELS[k]}</ReqLabel>
                    {k === "4" ? (
                      <textarea value={notes[k] ?? ""} onChange={(e) => setNote(k, e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
                    ) : (
                      <input value={notes[k] ?? ""} onChange={(e) => setNote(k, e.target.value)} style={inputStyle} />
                    )}
                  </div>
                )
              ))}
            </div>
          )}

          {/* Annexure remarks for the variable terms */}
          <button type="button" onClick={() => setShowRemarks((s) => !s)} style={sectionToggle}>
            <span className="material-symbols-outlined" style={chevron(showRemarks)}>chevron_right</span>
            Annexure remarks {showRemarks ? "" : "(defect liability, retention, safety, etc.)"}
          </button>

          {showRemarks && (
            <div style={{ ...sectionBox, gap: "10px" }}>
              {VARIABLE_ROWS.map((row) => (
                <div key={row.sl} style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr)", gap: "12px", alignItems: "center" }}>
                  <label style={{ fontSize: "12px", color: "#333333" }}>
                    <span style={{ color: "#999999", fontWeight: "bold", marginRight: "6px" }}>{row.sl}.</span>{row.title}
                    <span style={{ color: "#e30613" }}> *</span>
                  </label>
                  <input value={annexRemarks[row.sl] ?? ""} onChange={(e) => setAnnexRemarks((prev) => ({ ...prev, [row.sl]: e.target.value }))}
                    placeholder={row.defaultRemark || "Remark"} style={{ ...inputStyle, padding: "8px 10px" }} />
                </div>
              ))}
            </div>
          )}

          {/* Fixed contract window (optional) */}
          <div style={{ marginBottom: "16px" }}>
            <label style={labelStyle}>Fixed contract period <span style={{ color: "#bbbbbb" }}>(optional)</span></label>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#333333", paddingTop: "4px", cursor: "pointer" }}>
              <input type="checkbox" checked={fixedContract} onChange={(e) => setFixedContract(e.target.checked)} />
              Restrict vendor invoices to a date window
            </label>
          </div>

          {fixedContract && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div>
                <label style={labelStyle}>Contract start</label>
                <input type="date" value={contractStart} onChange={(e) => setContractStart(e.target.value)} style={inputStyle} />
              </div>
              <div>
                <label style={labelStyle}>Contract end</label>
                <input type="date" value={contractEnd} onChange={(e) => setContractEnd(e.target.value)} style={inputStyle} />
              </div>
            </div>
          )}

          <button onClick={generate}
            style={{ width: "100%", padding: "13px", border: "none", borderRadius: "8px", background: "#e30613", color: "white", fontSize: "14px", fontWeight: "bold", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>request_quote</span>
            {amendingId ? "Save Amendment & Download PO" : "Generate & Download PO"}
          </button>
        </div>

        {/* ── Existing POs — management (moved from the dashboard) ── */}
        <div style={{ background: "white", border: "1px solid #e4e2e1", borderRadius: "12px", padding: "24px" }}>
          <h3 style={{ fontSize: "14px", fontWeight: "bold", color: "#333333", marginBottom: "4px" }}>
            Vendors &amp; Purchase Orders
          </h3>
          <p style={{ fontSize: "12px", color: "#999999", marginBottom: "16px" }}>
            {selectedProject.name} · {listed.length}
          </p>

          {listed.length === 0 ? (
            <div style={{ padding: "32px 0", textAlign: "center", color: "#999999", fontSize: "13px" }}>
              No purchase orders yet.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {listed.map((po) => (
                <div key={po.id} style={{ border: "1px solid #e4e2e1", borderRadius: "8px", padding: "12px 14px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
                    <span style={{ fontSize: "13px", fontWeight: "bold", color: "#333333" }}>{po.vendorName}</span>
                    <span style={{ fontSize: "13px", fontWeight: "bold", color: "#e30613", whiteSpace: "nowrap" }}>{inr(po.poValue)}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "8px", marginTop: "2px" }}>
                    <div style={{ fontSize: "11px", color: "#999999" }}>
                      {po.poNumber}{po.projectName ? ` · ${po.projectName}` : ""}
                      {po.lines && po.lines.length > 0 ? ` · ${po.lines.length} line${po.lines.length === 1 ? "" : "s"}` : ""}
                    </div>
                    {po.lines && po.lines.length > 0 && (
                      <button type="button" title="Download PO document"
                        onClick={() => generatePoPdf({
                          poNumber: po.poNumber,
                          date: po.createdAt,
                          projectName: po.projectName ?? selectedProject.name,
                          clientName: selectedProject.clientName,
                          location: selectedProject.location,
                          vendorName: po.vendorName,
                          subject: `Purchase order for ${po.projectName ?? selectedProject.name}`,
                          billingLines: billingBranch(po.billingBranchId ?? undefined).billingLines,
                          lines: po.lines!,
                          poValue: po.poValue,
                          commencement: po.contractStart,
                          completion: po.contractEnd,
                        })}
                        style={{ display: "flex", alignItems: "center", border: "none", background: "none", cursor: "pointer", color: "#999999", padding: 0 }}>
                        <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>download</span>
                      </button>
                    )}
                  </div>
                  {po.lines && po.lines.length > 0 && (
                    <ul style={{ marginTop: "8px", borderTop: "1px solid #f0eeed", paddingTop: "8px", display: "flex", flexDirection: "column", gap: "4px" }}>
                      {po.lines.map((l) => (
                        <li key={l.id} style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "11px", color: "#666666" }}>
                          <span>{l.service} <span style={{ color: "#bbbbbb" }}>· {l.quantity} {l.unit} × {inr(l.rate)}</span></span>
                          <span style={{ whiteSpace: "nowrap", fontWeight: "bold", color: "#333333" }}>{inr(l.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {/* Acceptance / advance status line */}
                  <div style={{ marginTop: "8px" }}>
                    {po.advanceApproved ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.2)", color: "#16a34a" }}>
                        <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>verified</span>
                        Advance approved · {inr(po.advancePayable ?? 0)}
                      </span>
                    ) : po.advanceRequested != null ? (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", padding: "2px 8px", borderRadius: "999px", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", background: "rgba(202,138,4,0.1)", border: "1px solid rgba(202,138,4,0.25)", color: "#a16207" }}>
                        <span className="material-symbols-outlined" style={{ fontSize: "12px" }}>hourglass_top</span>
                        Advance {inr(po.advanceRequested)} pending
                      </span>
                    ) : po.acceptanceFileName ? (
                      isStored(po.acceptanceFileName) ? (
                        <button type="button" onClick={() => openDocument(po.acceptanceFileName!).catch((e) => toast.warning("Couldn't open", e instanceof Error ? e.message : "Try again."))}
                          style={{ fontSize: "11px", color: "#16a34a", display: "inline-flex", alignItems: "center", gap: "4px", border: "none", background: "none", padding: 0, cursor: "pointer", fontWeight: "bold" }}>
                          <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>task_alt</span>
                          Acceptance — view document
                        </button>
                      ) : (
                        <span style={{ fontSize: "11px", color: "#16a34a", display: "inline-flex", alignItems: "center", gap: "4px" }}>
                          <span className="material-symbols-outlined" style={{ fontSize: "13px" }}>task_alt</span>
                          Acceptance recorded
                        </span>
                      )
                    ) : (
                      <span style={{ fontSize: "11px", color: "#999999" }}>Pending acceptance</span>
                    )}
                  </div>

                  {/* Row actions */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
                    <button type="button" onClick={() => startAmend(po)}
                      style={poActionStyle("#666666")}>
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>edit_note</span>
                      Amend PO
                    </button>
                    <button type="button" onClick={() => handleDeletePO(po)}
                      style={poActionStyle("#ba1a1a")}>
                      <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>delete</span>
                      Delete
                    </button>
                    {!po.acceptanceFileName && (
                      <button type="button" onClick={() => { setAcceptanceId(po.id); setAcceptFile(null); setAcceptAdvance(""); }}
                        style={poActionStyle("#e30613")}>
                        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>upload_file</span>
                        Upload Acceptance
                      </button>
                    )}
                    {po.acceptanceFileName && po.advanceRequested != null && !po.advanceApproved && (
                      <button type="button" onClick={() => { setApprovingId(po.id); setAdvanceTdsPct(2); }}
                        style={poActionStyle("#16a34a")}>
                        <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>price_check</span>
                        Approve Advance
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      )}

      {/* Acceptance modal */}
      {acceptanceId && (() => {
        const po = listed.find((v) => v.id === acceptanceId);
        if (!po) return null;
        const over = Number(acceptAdvance) > po.poValue;
        return (
          <div style={modalOverlay} onClick={() => setAcceptanceId(null)}>
            <div style={modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={modalHeader}>
                <div>
                  <p style={{ fontSize: "18px", fontWeight: "bold", color: "#333333" }}>Vendor Acceptance</p>
                  <p style={{ fontSize: "12px", color: "#666666", marginTop: "2px" }}>Record the acceptance document and advance for {po.vendorName}</p>
                </div>
                <button onClick={() => setAcceptanceId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666666", display: "flex" }}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", background: "#f8f8f8", border: "1px solid #e4e2e1", borderRadius: "8px", padding: "12px 14px" }}>
                  <div><p style={labelStyle}>Vendor</p><p style={{ fontSize: "13px", fontWeight: "bold", color: "#333333" }}>{po.vendorName}</p></div>
                  <div><p style={labelStyle}>PO · Value</p><p style={{ fontSize: "13px", fontWeight: "bold", color: "#333333" }}>{po.poNumber} · {inr(po.poValue)}</p></div>
                </div>
                <div>
                  <ReqLabel>Advance amount (₹)</ReqLabel>
                  <input type="number" min="0" max={po.poValue} value={acceptAdvance} onChange={(e) => setAcceptAdvance(e.target.value)}
                    placeholder={`max ${inr(po.poValue)}`} style={{ ...inputStyle, borderColor: over ? "#ba1a1a" : "#e4e2e1" }} />
                  {over && <p style={{ fontSize: "11px", color: "#ba1a1a", marginTop: "4px" }}>Advance cannot exceed the PO value.</p>}
                </div>
                <div>
                  <ReqLabel>Acceptance document</ReqLabel>
                  <input ref={acceptRef} type="file" accept=".pdf,.png,.jpg,.jpeg,.doc,.docx" hidden onChange={(e) => setAcceptFile(e.target.files?.[0] ?? null)} />
                  <button type="button" onClick={() => acceptRef.current?.click()}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: "8px", border: `1px ${acceptFile ? "solid #16a34a" : "dashed #e4e2e1"}`, borderRadius: "8px", background: acceptFile ? "rgba(22,163,74,0.05)" : "white", color: "#333333", fontSize: "13px", padding: "10px 12px", cursor: "pointer" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: "18px", color: acceptFile ? "#16a34a" : "#666666" }}>{acceptFile ? "task" : "upload_file"}</span>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acceptFile?.name || "Upload the signed acceptance document"}</span>
                  </button>
                </div>
              </div>
              <div style={modalFooter}>
                <button onClick={() => setAcceptanceId(null)} style={modalCancelBtn}>Cancel</button>
                <button onClick={submitAcceptance} style={modalPrimaryBtn}>Record Acceptance</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Advance approval modal */}
      {approvingId && (() => {
        const po = listed.find((v) => v.id === approvingId);
        if (!po) return null;
        const req = po.advanceRequested ?? 0;
        const payable = req * (1 - advanceTdsPct / 100);
        return (
          <div style={modalOverlay} onClick={() => setApprovingId(null)}>
            <div style={modalCard} onClick={(e) => e.stopPropagation()}>
              <div style={modalHeader}>
                <div>
                  <p style={{ fontSize: "18px", fontWeight: "bold", color: "#333333" }}>Approve Advance</p>
                  <p style={{ fontSize: "12px", color: "#666666", marginTop: "2px" }}>Apply TDS and approve the advance for {po.vendorName}</p>
                </div>
                <button onClick={() => setApprovingId(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "#666666", display: "flex" }}>
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
              <div style={{ padding: "24px", display: "flex", flexDirection: "column", gap: "16px" }}>
                <div>
                  <label style={labelStyle}>TDS %</label>
                  <select value={advanceTdsPct} onChange={(e) => setAdvanceTdsPct(Number(e.target.value))} style={inputStyle}>
                    <option value={0}>No TDS</option>
                    {[1, 2, 10].map((p) => <option key={p} value={p}>{p}%</option>)}
                  </select>
                </div>
                <div style={{ background: "#f8f8f8", border: "1px solid #e4e2e1", borderRadius: "8px", padding: "12px 14px", display: "flex", flexDirection: "column", gap: "6px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#666666" }}><span>Advance Requested</span><span style={{ fontWeight: 600, color: "#333333" }}>{inr(req)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", color: "#666666" }}><span>TDS ({advanceTdsPct}%)</span><span style={{ fontWeight: 600, color: "#ba1a1a" }}>−{inr(req * advanceTdsPct / 100)}</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px", fontWeight: "bold", borderTop: "1px solid #e4e2e1", paddingTop: "6px" }}><span style={{ color: "#333333" }}>Advance Payable</span><span style={{ color: "#16a34a" }}>{inr(payable)}</span></div>
                </div>
              </div>
              <div style={modalFooter}>
                <button onClick={() => setApprovingId(null)} style={modalCancelBtn}>Cancel</button>
                <button onClick={submitApproveAdvance} style={{ ...modalPrimaryBtn, background: "#16a34a" }}>Approve Advance</button>
              </div>
            </div>
          </div>
        );
      })()}
      </>)}
    </div>
  );
}
