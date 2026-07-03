"use client";
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/lib/toast";
import {
  loadBudgetBoq,
  loadIntents,
  raiseIntent,
  approveIntent,
  rejectIntent,
  type BudgetBoqDTO,
  type IntentDTO,
} from "./procurement";

const card: React.CSSProperties = { background: "white", border: "1px solid #e4e2e1", borderRadius: "12px", padding: "24px" };
const label: React.CSSProperties = { fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", color: "#999999", marginBottom: "6px", display: "block" };
const input: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #e4e2e1", borderRadius: "8px", fontSize: "13px", color: "#333333", background: "white", boxSizing: "border-box" };

const STATUS_LABEL: Record<string, string> = {
  PENDING_PD_APPROVAL: "Pending PD Approval",
  PD_REJECTED: "Rejected by PD",
  PD_APPROVED: "Approved",
  QUOTES_PENDING: "Awaiting Quotes",
  COMPARISON_PENDING_PD: "Comparison · PD Review",
  PENDING_FINANCE: "Pending Finance",
  FINANCE_APPROVED: "Finance Approved",
  PO_RELEASED: "PO Released",
};
const STATUS_COLOR: Record<string, string> = {
  PENDING_PD_APPROVAL: "#e58a00", PD_REJECTED: "#ba1a1a", PD_APPROVED: "#16a34a",
  QUOTES_PENDING: "#0059a8", COMPARISON_PENDING_PD: "#0059a8", PENDING_FINANCE: "#e58a00",
  FINANCE_APPROVED: "#16a34a", PO_RELEASED: "#333333",
};

function StatusPill({ status }: { status: string }) {
  const c = STATUS_COLOR[status] ?? "#666666";
  return <span style={{ fontSize: "11px", fontWeight: "bold", padding: "3px 9px", borderRadius: "999px", background: `${c}1a`, color: c }}>{STATUS_LABEL[status] ?? status}</span>;
}

type Row = { item: string; unit: string; qty: string };

export default function IntentsTab({ projectId, projectName, role }: { projectId: string; projectName: string; role: string }) {
  const toast = useToast();
  const [budget, setBudget] = useState<BudgetBoqDTO | null>(null);
  const [intents, setIntents] = useState<IntentDTO[]>([]);
  const [pkg, setPkg] = useState("");
  const [rows, setRows] = useState<Row[]>([{ item: "", unit: "", qty: "" }]);
  const [busy, setBusy] = useState(false);
  const [reconfirm, setReconfirm] = useState<Record<string, boolean>>({});

  const isPm = role === "PROJECT_MANAGER" || role === "ADMIN";
  const isPd = role === "PROJECT_DIRECTOR" || role === "ADMIN";

  const refresh = () => loadIntents(projectId).then(setIntents).catch(() => setIntents([]));
  useEffect(() => {
    if (!projectId) return;
    loadBudgetBoq(projectId).then(setBudget).catch(() => setBudget(null));
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // Live budget check for a row being typed (mirrors the server gating).
  const remainingFor = useMemo(() => {
    const map = new Map<string, { unit: string; remaining: number }>();
    budget?.lines.forEach((l) => map.set(l.item.trim().toLowerCase(), { unit: l.unit, remaining: l.remainingQty }));
    return map;
  }, [budget]);

  function rowFlag(r: Row): { kind: "ok" | "new" | "over"; remaining?: number } {
    if (!r.item.trim()) return { kind: "ok" };
    const m = remainingFor.get(r.item.trim().toLowerCase());
    if (!m) return { kind: "new" };
    if (Number(r.qty) > m.remaining) return { kind: "over", remaining: m.remaining };
    return { kind: "ok", remaining: m.remaining };
  }

  function setRow(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function submit() {
    const lines = rows
      .filter((r) => r.item.trim() && Number(r.qty) > 0)
      .map((r) => ({ item: r.item.trim(), unit: r.unit.trim(), requestedQty: Number(r.qty) }));
    if (!lines.length) { toast.warning("Add an item", "Enter at least one item with a quantity."); return; }
    setBusy(true);
    try {
      const created = await raiseIntent({ projectId, projectName, packageName: pkg || undefined, lines });
      await refresh();
      setRows([{ item: "", unit: "", qty: "" }]); setPkg("");
      toast[created.limitExceeded ? "warning" : "success"](
        created.limitExceeded ? "Raised — over budget" : "Intent raised",
        created.limitExceeded
          ? `${created.intentNumber} exceeds the budget BOQ. The Project Director must reconfirm before approval.`
          : `${created.intentNumber} sent to the Project Director.`,
      );
    } catch (err) {
      toast.warning("Couldn't raise intent", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function approve(intent: IntentDTO) {
    setBusy(true);
    try {
      await approveIntent({ intentId: intent.id, reconfirm: !!reconfirm[intent.id] });
      await refresh();
      toast.success("Intent approved", `${intent.intentNumber} can now move to quotes.`);
    } catch (err) {
      toast.warning("Couldn't approve", err instanceof Error ? err.message : "Try again.");
    } finally { setBusy(false); }
  }

  async function reject(intent: IntentDTO) {
    const reason = prompt(`Reason for rejecting ${intent.intentNumber}?`);
    if (!reason) return;
    setBusy(true);
    try {
      await rejectIntent({ intentId: intent.id, reason });
      await refresh();
      toast.success("Intent rejected", `${intent.intentNumber} sent back.`);
    } catch (err) {
      toast.warning("Couldn't reject", err instanceof Error ? err.message : "Try again.");
    } finally { setBusy(false); }
  }

  const pending = intents.filter((i) => i.status === "PENDING_PD_APPROVAL");
  const budgetReady = budget?.status === "RELEASED";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Raise intent (Project Manager) */}
      {isPm && (
        <div style={card}>
          <h3 style={{ fontSize: "16px", fontWeight: "bold", color: "#333333" }}>Raise a Purchase Intent</h3>
          <p style={{ fontSize: "13px", color: "#999999", marginTop: "4px", marginBottom: "16px" }}>
            Items and quantities are checked against the budget BOQ. Over-budget or new items still submit, but flag the Project Director for reconfirmation.
          </p>
          {!budgetReady ? (
            <div style={{ padding: "16px", background: "rgba(229,138,0,0.08)", borderRadius: "8px", fontSize: "13px", color: "#a36200" }}>
              The budget BOQ for this project hasn&apos;t been released yet — intents can&apos;t be raised until the QS releases it.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: "14px", maxWidth: "320px" }}>
                <label style={label}>Package (optional)</label>
                <input value={pkg} onChange={(e) => setPkg(e.target.value)} placeholder="e.g. Flooring package" style={input} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                {rows.map((r, i) => {
                  const flag = rowFlag(r);
                  return (
                    <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,2fr) minmax(0,0.8fr) minmax(0,0.8fr) auto", gap: "10px", alignItems: "start" }}>
                      <div>
                        <input list="budget-items" value={r.item} onChange={(e) => setRow(i, { item: e.target.value })} placeholder="Item" style={input} />
                        {flag.kind === "new" && <span style={{ fontSize: "11px", color: "#e58a00" }}>New item — not in budget BOQ</span>}
                        {flag.kind === "over" && <span style={{ fontSize: "11px", color: "#ba1a1a" }}>Over budget — only {flag.remaining} remaining</span>}
                        {flag.kind === "ok" && flag.remaining != null && <span style={{ fontSize: "11px", color: "#16a34a" }}>{flag.remaining} remaining</span>}
                      </div>
                      <input value={r.unit} onChange={(e) => setRow(i, { unit: e.target.value })} placeholder="Unit" style={input} />
                      <input type="number" min="0" value={r.qty} onChange={(e) => setRow(i, { qty: e.target.value })} placeholder="Qty" style={input} />
                      <button type="button" onClick={() => setRows((p) => p.length > 1 ? p.filter((_, idx) => idx !== i) : p)}
                        style={{ border: "none", background: "none", color: "#999999", cursor: "pointer", padding: "8px" }} aria-label="Remove row">
                        <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
                      </button>
                    </div>
                  );
                })}
                <datalist id="budget-items">
                  {budget?.lines.map((l) => <option key={l.id} value={l.item} />)}
                </datalist>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: "14px" }}>
                <button type="button" onClick={() => setRows((p) => [...p, { item: "", unit: "", qty: "" }])}
                  style={{ border: "1px solid #e4e2e1", borderRadius: "8px", background: "white", color: "#333333", fontSize: "12px", fontWeight: "bold", padding: "8px 14px", cursor: "pointer" }}>+ Add item</button>
                <button onClick={submit} disabled={busy}
                  style={{ border: "none", borderRadius: "8px", background: "#e30613", color: "white", fontSize: "13px", fontWeight: "bold", padding: "9px 20px", cursor: busy ? "wait" : "pointer" }}>
                  {busy ? "Submitting…" : "Submit Intent"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* PD approval queue */}
      {isPd && pending.length > 0 && (
        <div style={card}>
          <h3 style={{ fontSize: "16px", fontWeight: "bold", color: "#333333", marginBottom: "4px" }}>Awaiting your approval</h3>
          <p style={{ fontSize: "13px", color: "#999999", marginBottom: "16px" }}>Project Director sign-off · {pending.length}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {pending.map((intent) => (
              <div key={intent.id} style={{ border: `1px solid ${intent.limitExceeded ? "rgba(227,6,19,0.3)" : "#e4e2e1"}`, borderRadius: "10px", padding: "16px", background: intent.limitExceeded ? "rgba(227,6,19,0.03)" : "white" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: "14px", fontWeight: "bold", color: "#333333" }}>{intent.intentNumber} <span style={{ fontWeight: "normal", color: "#999999" }}>· {intent.raisedBy}{intent.packageName ? ` · ${intent.packageName}` : ""}</span></div>
                  <StatusPill status={intent.status} />
                </div>
                {intent.limitExceeded && (
                  <div style={{ marginTop: "10px", padding: "10px 12px", background: "rgba(227,6,19,0.07)", borderRadius: "8px", fontSize: "12px", color: "#ba1a1a", display: "flex", gap: "8px", alignItems: "flex-start" }}>
                    <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>warning</span>
                    <span>This intent crosses the budget BOQ limit. Reconfirm to approve.</span>
                  </div>
                )}
                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "12px" }}>
                  <thead><tr>
                    {["Item", "Unit", "Requested", "Available", "Flag"].map((h) => (
                      <th key={h} style={{ fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", color: "#999999", textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #f0eeed" }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {intent.lines.map((l) => (
                      <tr key={l.id}>
                        <td style={{ padding: "6px 8px", fontSize: "13px", color: "#333333" }}>{l.item}</td>
                        <td style={{ padding: "6px 8px", fontSize: "13px", color: "#666666" }}>{l.unit || "—"}</td>
                        <td style={{ padding: "6px 8px", fontSize: "13px", color: "#333333" }}>{l.requestedQty}</td>
                        <td style={{ padding: "6px 8px", fontSize: "13px", color: "#666666" }}>{l.isNewItem ? "—" : l.availableQtyAtSubmit}</td>
                        <td style={{ padding: "6px 8px", fontSize: "12px", fontWeight: "bold", color: l.isNewItem ? "#e58a00" : l.exceedsBudget ? "#ba1a1a" : "#16a34a" }}>
                          {l.isNewItem ? "New item" : l.exceedsBudget ? "Over budget" : "Within budget"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "14px", gap: "12px", flexWrap: "wrap" }}>
                  {intent.limitExceeded ? (
                    <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "#333333", cursor: "pointer" }}>
                      <input type="checkbox" checked={!!reconfirm[intent.id]} onChange={(e) => setReconfirm((p) => ({ ...p, [intent.id]: e.target.checked }))} />
                      I reconfirm this purchase despite the budget limit being crossed
                    </label>
                  ) : <span />}
                  <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={() => reject(intent)} disabled={busy}
                      style={{ border: "1px solid #ba1a1a", borderRadius: "8px", background: "white", color: "#ba1a1a", fontSize: "13px", fontWeight: "bold", padding: "8px 16px", cursor: "pointer" }}>Reject</button>
                    <button onClick={() => approve(intent)} disabled={busy || (intent.limitExceeded && !reconfirm[intent.id])}
                      style={{ border: "none", borderRadius: "8px", background: intent.limitExceeded && !reconfirm[intent.id] ? "#cccccc" : "#16a34a", color: "white", fontSize: "13px", fontWeight: "bold", padding: "8px 18px", cursor: intent.limitExceeded && !reconfirm[intent.id] ? "not-allowed" : "pointer" }}>Approve</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All intents */}
      <div style={card}>
        <h3 style={{ fontSize: "14px", fontWeight: "bold", color: "#333333", marginBottom: "4px" }}>Purchase Intents</h3>
        <p style={{ fontSize: "12px", color: "#999999", marginBottom: "16px" }}>{projectName} · {intents.length}</p>
        {intents.length === 0 ? (
          <p style={{ fontSize: "13px", color: "#999999", padding: "16px 0", textAlign: "center" }}>No intents raised yet.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column" }}>
            {intents.map((i) => (
              <div key={i.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid #f0eeed", gap: "12px" }}>
                <div>
                  <div style={{ fontSize: "13px", fontWeight: "bold", color: "#333333" }}>{i.intentNumber} {i.limitExceeded && <span title="Crossed budget limit" className="material-symbols-outlined" style={{ fontSize: "15px", color: "#e30613", verticalAlign: "middle" }}>warning</span>}</div>
                  <div style={{ fontSize: "12px", color: "#999999" }}>{i.lines.length} item(s) · {i.raisedBy} · {i.createdAt}{i.pdRejectReason ? ` · ${i.pdRejectReason}` : ""}</div>
                </div>
                <StatusPill status={i.status} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
