"use client";
import { useEffect, useState } from "react";
import { useToast } from "@/lib/toast";
import { uploadFileToStorage, openDocument, isStored, docName } from "../docs";
import {
  loadIntents,
  addVendorQuote,
  submitComparison,
  chooseVendor,
  financeApprove,
  releaseIntentPo,
  type IntentDTO,
} from "./procurement";

const card: React.CSSProperties = { background: "white", border: "1px solid #e4e2e1", borderRadius: "12px", padding: "24px" };
const label: React.CSSProperties = { fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", color: "#999999", marginBottom: "6px", display: "block" };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #e4e2e1", borderRadius: "8px", fontSize: "13px", color: "#333333", background: "white", boxSizing: "border-box" };
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const btn = (bg: string): React.CSSProperties => ({ border: "none", borderRadius: "8px", background: bg, color: "white", fontSize: "13px", fontWeight: "bold", padding: "8px 16px", cursor: "pointer" });

type QRow = { item: string; unit: string; qty: string; rate: string };

// Lifecycle stages handled by this tab (after PD approval, before / at PO release).
const ACTIVE = ["QUOTES_PENDING", "COMPARISON_PENDING_PD", "PENDING_FINANCE", "FINANCE_APPROVED", "PO_RELEASED"];

export default function ComparisonTab({ projectId, role }: { projectId: string; projectName: string; role: string }) {
  const toast = useToast();
  const [intents, setIntents] = useState<IntentDTO[]>([]);
  const [busy, setBusy] = useState(false);
  const [quoteFor, setQuoteFor] = useState<string | null>(null);
  const [vendor, setVendor] = useState(""); const [gstin, setGstin] = useState(""); const [bank, setBank] = useState("");
  const [qrows, setQrows] = useState<QRow[]>([]);
  const [quoteFile, setQuoteFile] = useState<File | null>(null);
  // Per-intent file selections for the comparison sheet and the chosen-vendor BOQ.
  const [compFiles, setCompFiles] = useState<Record<string, File | null>>({});
  const [chosenFiles, setChosenFiles] = useState<Record<string, File | null>>({});

  const isProc = role === "PROCUREMENT_MANAGER" || role === "ADMIN";
  const isPd = role === "PROJECT_DIRECTOR" || role === "ADMIN";
  const isFin = role === "FINANCE" || role === "ADMIN";

  const refresh = () => loadIntents(projectId).then((all) => setIntents(all.filter((i) => ACTIVE.includes(i.status)))).catch(() => setIntents([]));
  useEffect(() => {
    if (projectId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  function openQuote(intent: IntentDTO) {
    setQuoteFor(intent.id);
    setVendor(""); setGstin(""); setBank(""); setQuoteFile(null);
    setQrows(intent.lines.map((l) => ({ item: l.item, unit: l.unit, qty: String(l.requestedQty), rate: "" })));
  }

  async function saveQuote() {
    if (!quoteFor) return;
    const lines = qrows.filter((r) => r.item.trim() && Number(r.qty) > 0).map((r) => ({ item: r.item.trim(), unit: r.unit.trim(), quantity: Number(r.qty), rate: Number(r.rate) || 0 }));
    if (!vendor.trim() || !lines.length) { toast.warning("Add details", "Enter a vendor name and at least one priced line."); return; }
    setBusy(true);
    try {
      const fileName = quoteFile ? await uploadFileToStorage(quoteFile, "vendor-quote") : undefined;
      await addVendorQuote({ intentId: quoteFor, vendorName: vendor, vendorGstin: gstin || undefined, vendorBankDetails: bank || undefined, fileName, lines });
      await refresh();
      setQuoteFor(null);
      toast.success("Quote added", `${vendor} added to the comparison.`);
    } catch (err) { toast.warning("Couldn't add quote", err instanceof Error ? err.message : "Try again."); }
    finally { setBusy(false); }
  }

  async function doSubmitComparison(intent: IntentDTO) {
    setBusy(true);
    try {
      const file = compFiles[intent.id];
      const comparisonFileName = file ? await uploadFileToStorage(file, "comparison-boq") : undefined;
      await submitComparison({ intentId: intent.id, comparisonFileName });
      await refresh();
      toast.success("Comparison submitted", `${intent.intentNumber} sent to the Project Director.`);
    }
    catch (err) { toast.warning("Couldn't submit", err instanceof Error ? err.message : "Try again."); }
    finally { setBusy(false); }
  }

  async function doChoose(intent: IntentDTO, quoteId: string) {
    setBusy(true);
    try {
      const file = chosenFiles[intent.id];
      const chosenVendorBoqFileName = file ? await uploadFileToStorage(file, "chosen-boq") : undefined;
      await chooseVendor({ intentId: intent.id, quoteId, chosenVendorBoqFileName });
      await refresh();
      toast.success("Vendor selected", "Sent to Finance for verification.");
    }
    catch (err) { toast.warning("Couldn't select vendor", err instanceof Error ? err.message : "Try again."); }
    finally { setBusy(false); }
  }

  async function doFinance(intent: IntentDTO) {
    const notes = prompt("Verification note (vendor financial details confirmed):", "Bank & GST details verified.") ?? undefined;
    setBusy(true);
    try { await financeApprove({ intentId: intent.id, notes }); await refresh(); toast.success("Finance approved", "The PO can now be released."); }
    catch (err) { toast.warning("Couldn't approve", err instanceof Error ? err.message : "Try again."); }
    finally { setBusy(false); }
  }

  async function doRelease(intent: IntentDTO) {
    const poNumber = prompt(`PO number for ${intent.intentNumber}?`, "");
    if (!poNumber) return;
    setBusy(true);
    try { await releaseIntentPo({ intentId: intent.id, poNumber }); await refresh(); toast.success("PO released", `PO ${poNumber} created and the budget drawn down.`); }
    catch (err) { toast.warning("Couldn't release PO", err instanceof Error ? err.message : "Try again."); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={card}>
        <h3 style={{ fontSize: "16px", fontWeight: "bold", color: "#333333" }}>Quote Comparison &amp; PO Release</h3>
        <p style={{ fontSize: "13px", color: "#999999", marginTop: "4px" }}>
          Procurement collects quotes → Project Director selects a vendor → Finance verifies → PO is released, importing the chosen vendor&apos;s BOQ.
        </p>
      </div>

      {intents.length === 0 && (
        <div style={card}><p style={{ fontSize: "13px", color: "#999999", textAlign: "center", padding: "16px 0" }}>No approved intents awaiting procurement.</p></div>
      )}

      {intents.map((intent) => {
        const chosen = intent.quotes.find((q) => q.id === intent.chosenQuoteId);
        return (
          <div key={intent.id} style={card}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
              <div style={{ fontSize: "15px", fontWeight: "bold", color: "#333333" }}>{intent.intentNumber}
                <span style={{ fontWeight: "normal", color: "#999999" }}>  ·  {intent.lines.length} item(s){intent.packageName ? ` · ${intent.packageName}` : ""}</span>
              </div>
              <span style={{ fontSize: "11px", fontWeight: "bold", color: "#0059a8" }}>{intent.status.replaceAll("_", " ")}</span>
            </div>

            {/* Vendor quotes */}
            {intent.quotes.length > 0 && (
              <div style={{ marginTop: "14px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "12px" }}>
                {intent.quotes.map((q) => {
                  const isChosen = q.id === intent.chosenQuoteId;
                  return (
                    <div key={q.id} style={{ border: `1px solid ${isChosen ? "#16a34a" : "#e4e2e1"}`, borderRadius: "10px", padding: "14px", background: isChosen ? "rgba(22,163,74,0.04)" : "white" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: "13px", fontWeight: "bold", color: "#333333" }}>{q.vendorName}</span>
                        {isChosen && <span className="material-symbols-outlined" style={{ fontSize: "18px", color: "#16a34a" }}>check_circle</span>}
                      </div>
                      <div style={{ fontSize: "16px", fontWeight: "bold", color: "#333333", marginTop: "6px" }}>{inr(q.totalValue)}</div>
                      {q.vendorGstin && <div style={{ fontSize: "11px", color: "#999999", marginTop: "2px" }}>GSTIN {q.vendorGstin}</div>}
                      {q.vendorBankDetails && <div style={{ fontSize: "11px", color: "#999999" }}>{q.vendorBankDetails}</div>}
                      {isStored(q.fileName) && (
                        <button type="button" onClick={() => openDocument(q.fileName!).catch((e) => toast.warning("Couldn't open", e instanceof Error ? e.message : "Try again."))}
                          style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginTop: "6px", border: "none", background: "none", color: "#0059a8", fontSize: "11px", fontWeight: "bold", padding: 0, cursor: "pointer" }}>
                          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>description</span> {docName(q.fileName)}
                        </button>
                      )}
                      {isPd && intent.status === "COMPARISON_PENDING_PD" && (
                        <button onClick={() => doChoose(intent, q.id)} disabled={busy} style={{ ...btn("#0059a8"), marginTop: "10px", width: "100%", padding: "6px" }}>Choose this vendor</button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Procurement: add quotes / submit comparison */}
            {isProc && (intent.status === "QUOTES_PENDING") && (
              <div style={{ marginTop: "14px", display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <button onClick={() => openQuote(intent)} style={{ border: "1px solid #e4e2e1", borderRadius: "8px", background: "white", color: "#333333", fontSize: "13px", fontWeight: "bold", padding: "8px 16px", cursor: "pointer" }}>+ Add vendor quote</button>
                {intent.quotes.length >= 1 && (
                  <>
                    <label style={{ fontSize: "12px", color: "#666666", display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>attach_file</span>
                      {compFiles[intent.id]?.name ?? "Comparison sheet (optional)"}
                      <input type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" hidden onChange={(e) => setCompFiles((p) => ({ ...p, [intent.id]: e.target.files?.[0] ?? null }))} />
                    </label>
                    <button onClick={() => doSubmitComparison(intent)} disabled={busy} style={btn("#e30613")}>Submit comparison to PD</button>
                  </>
                )}
              </div>
            )}

            {/* PD: attach the chosen-vendor BOQ before selecting */}
            {isPd && intent.status === "COMPARISON_PENDING_PD" && (
              <div style={{ marginTop: "12px", display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
                {isStored(intent.comparisonFileName) && (
                  <button type="button" onClick={() => openDocument(intent.comparisonFileName!).catch((e) => toast.warning("Couldn't open", e instanceof Error ? e.message : "Try again."))}
                    style={{ display: "inline-flex", alignItems: "center", gap: "4px", border: "none", background: "none", color: "#0059a8", fontSize: "12px", fontWeight: "bold", padding: 0, cursor: "pointer" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>table_chart</span> {docName(intent.comparisonFileName)}
                  </button>
                )}
                <label style={{ fontSize: "12px", color: "#666666", display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                  <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>upload_file</span>
                  {chosenFiles[intent.id]?.name ?? "Chosen-vendor BOQ (optional)"}
                  <input type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" hidden onChange={(e) => setChosenFiles((p) => ({ ...p, [intent.id]: e.target.files?.[0] ?? null }))} />
                </label>
                <span style={{ fontSize: "12px", color: "#999999" }}>— then choose a vendor above.</span>
              </div>
            )}

            {/* Finance verification */}
            {intent.status === "PENDING_FINANCE" && (
              <div style={{ marginTop: "14px", padding: "12px 14px", background: "#f8f8f8", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ fontSize: "13px", color: "#666666" }}>
                  Chosen vendor: <strong style={{ color: "#333333" }}>{chosen?.vendorName ?? "—"}</strong> — verify financial details.
                  {chosen?.vendorGstin && <> · GSTIN {chosen.vendorGstin}</>}
                  {isStored(intent.chosenVendorBoqFileName) && (
                    <button type="button" onClick={() => openDocument(intent.chosenVendorBoqFileName!).catch((e) => toast.warning("Couldn't open", e instanceof Error ? e.message : "Try again."))}
                      style={{ display: "inline-flex", alignItems: "center", gap: "4px", marginLeft: "10px", border: "none", background: "none", color: "#0059a8", fontSize: "12px", fontWeight: "bold", padding: 0, cursor: "pointer" }}>
                      <span className="material-symbols-outlined" style={{ fontSize: "15px" }}>description</span> {docName(intent.chosenVendorBoqFileName)}
                    </button>
                  )}
                </div>
                {isFin && <button onClick={() => doFinance(intent)} disabled={busy} style={btn("#16a34a")}>Verify &amp; Approve</button>}
              </div>
            )}

            {/* PO release */}
            {intent.status === "FINANCE_APPROVED" && (
              <div style={{ marginTop: "14px", padding: "12px 14px", background: "rgba(22,163,74,0.06)", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "12px", flexWrap: "wrap" }}>
                <div style={{ fontSize: "13px", color: "#16a34a" }}>Finance approved{intent.financeApprovedBy ? ` by ${intent.financeApprovedBy}` : ""}. Ready to release the PO from {chosen?.vendorName ?? "the chosen vendor"}.</div>
                {isProc && <button onClick={() => doRelease(intent)} disabled={busy} style={btn("#e30613")}>Release PO</button>}
              </div>
            )}

            {intent.status === "PO_RELEASED" && (
              <div style={{ marginTop: "14px", fontSize: "13px", color: "#666666" }}>✓ PO released for {chosen?.vendorName}. Budget BOQ quantities drawn down.</div>
            )}

            {/* Inline quote builder */}
            {quoteFor === intent.id && (
              <div style={{ marginTop: "16px", border: "1px solid #e4e2e1", borderRadius: "10px", padding: "16px" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "12px", marginBottom: "12px" }}>
                  <div><label style={label}>Vendor</label><input value={vendor} onChange={(e) => setVendor(e.target.value)} style={input} /></div>
                  <div><label style={label}>GSTIN</label><input value={gstin} onChange={(e) => setGstin(e.target.value)} style={input} /></div>
                  <div><label style={label}>Bank details</label><input value={bank} onChange={(e) => setBank(e.target.value)} style={input} /></div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {qrows.map((r, i) => (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,0.7fr) minmax(0,0.7fr) minmax(0,1fr)", gap: "8px" }}>
                      <input value={r.item} onChange={(e) => setQrows((p) => p.map((x, idx) => idx === i ? { ...x, item: e.target.value } : x))} placeholder="Item" style={input} />
                      <input value={r.unit} onChange={(e) => setQrows((p) => p.map((x, idx) => idx === i ? { ...x, unit: e.target.value } : x))} placeholder="Unit" style={input} />
                      <input type="number" value={r.qty} onChange={(e) => setQrows((p) => p.map((x, idx) => idx === i ? { ...x, qty: e.target.value } : x))} placeholder="Qty" style={input} />
                      <input type="number" value={r.rate} onChange={(e) => setQrows((p) => p.map((x, idx) => idx === i ? { ...x, rate: e.target.value } : x))} placeholder="Rate" style={input} />
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", marginTop: "12px", flexWrap: "wrap" }}>
                  <label style={{ fontSize: "12px", color: "#666666", display: "inline-flex", alignItems: "center", gap: "6px", cursor: "pointer" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>attach_file</span>
                    {quoteFile?.name ?? "Attach quote document (optional)"}
                    <input type="file" accept=".pdf,.xlsx,.xls,.png,.jpg,.jpeg" hidden onChange={(e) => setQuoteFile(e.target.files?.[0] ?? null)} />
                  </label>
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={() => setQuoteFor(null)} style={{ border: "1px solid #e4e2e1", borderRadius: "8px", background: "white", color: "#333333", fontSize: "13px", fontWeight: "bold", padding: "8px 16px", cursor: "pointer" }}>Cancel</button>
                    <button onClick={saveQuote} disabled={busy} style={btn("#16a34a")}>Save quote</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
