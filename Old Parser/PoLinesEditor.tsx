"use client";
import type { Dispatch, SetStateAction } from "react";

// A service line being edited in a form. Quantity/rate are kept as strings so the
// inputs can be cleared; they're parsed to numbers when the amount is computed.
export interface DraftLine {
  service: string;
  unit: string;
  quantity: string;
  rate: string;
  hsn?: string; // HSN/SAC code — only collected on the PO generator (see showHsn).
}

export const emptyLine: DraftLine = { service: "", unit: "", quantity: "", rate: "", hsn: "" };

export const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

export const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const linesTotal = (lines: DraftLine[]) =>
  lines.reduce((s, l) => s + num(l.quantity) * num(l.rate), 0);

// A priced PO line plus the HSN/SAC code carried only for document generation. The
// hsn is dropped before persistence (the DB POLine has no such column).
export type PricedLine = {
  id: string;
  service: string;
  unit: string;
  quantity: number;
  rate: number;
  amount: number;
  hsn?: string;
};

// Turns the draft lines into priced PO lines, dropping incomplete rows. Returns the
// lines (with a generated id + computed amount) and their summed value.
export function buildPoLines(lines: DraftLine[]): { poLines: PricedLine[]; poValue: number } {
  const valid = lines
    .map((l) => ({ ...l, qn: num(l.quantity), rn: num(l.rate) }))
    .filter((l) => l.service.trim() && l.qn > 0 && l.rn >= 0);
  const poLines = valid.map((l, idx) => ({
    id: `line_${Date.now()}_${idx}`,
    service: l.service.trim(),
    unit: l.unit.trim() || "—",
    quantity: l.qn,
    rate: l.rn,
    amount: l.qn * l.rn,
    hsn: l.hsn?.trim() || undefined,
  }));
  return { poLines, poValue: poLines.reduce((s, l) => s + l.amount, 0) };
}

const cellInput: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  border: "1px solid #e4e2e1",
  borderRadius: "8px",
  fontSize: "13px",
  color: "#333333",
  background: "white",
  boxSizing: "border-box",
};
const GRID = "minmax(0,2.2fr) minmax(0,0.8fr) minmax(0,0.8fr) minmax(0,1fr) minmax(0,1.1fr) 28px";
const GRID_HSN = "minmax(0,2.2fr) minmax(0,0.9fr) minmax(0,0.7fr) minmax(0,0.7fr) minmax(0,1fr) minmax(0,1.1fr) 28px";

// Controlled editor for a purchase order's service line items. Shared by the
// dashboard "Add Vendor" modal and the Generate Purchase Order page. The PO page
// passes showHsn to collect an HSN/SAC code per line for the generated document.
export function PoLinesEditor({
  lines,
  setLines,
  showHsn = false,
}: {
  lines: DraftLine[];
  setLines: Dispatch<SetStateAction<DraftLine[]>>;
  showHsn?: boolean;
}) {
  const grid = showHsn ? GRID_HSN : GRID;
  const setLine = (i: number, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const addLine = () => setLines((prev) => [...prev, { ...emptyLine }]);
  const removeLine = (i: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const total = linesTotal(lines);

  return (
    <div>
      <div style={{ border: "1px solid #e4e2e1", borderRadius: "8px", overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: grid, gap: "8px", padding: "10px 12px", background: "#f8f8f8", borderBottom: "1px solid #e4e2e1", fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", color: "#999999" }}>
          <span>Service / Scope</span>
          {showHsn && <span>HSN/SAC</span>}
          <span>Unit</span>
          <span>Qty</span>
          <span>Rate</span>
          <span style={{ textAlign: "right" }}>Amount</span>
          <span />
        </div>
        {lines.map((l, i) => {
          const amount = num(l.quantity) * num(l.rate);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: grid, gap: "8px", padding: "8px 12px", alignItems: "center", borderBottom: "1px solid #f0eeed" }}>
              <input value={l.service} onChange={(e) => setLine(i, { service: e.target.value })} placeholder="Stone cladding – facade" style={cellInput} />
              {showHsn && <input value={l.hsn ?? ""} onChange={(e) => setLine(i, { hsn: e.target.value })} placeholder="995457" style={cellInput} />}
              <input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} placeholder="sqm" style={cellInput} />
              <input value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} inputMode="decimal" placeholder="0" style={cellInput} />
              <input value={l.rate} onChange={(e) => setLine(i, { rate: e.target.value })} inputMode="decimal" placeholder="0" style={cellInput} />
              <span style={{ fontSize: "13px", fontWeight: "bold", color: "#333333", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis" }}>{inr(amount)}</span>
              <button type="button" onClick={() => removeLine(i)} disabled={lines.length === 1} aria-label="Remove line"
                style={{ display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: lines.length === 1 ? "not-allowed" : "pointer", color: lines.length === 1 ? "#d4d2d1" : "#999999", padding: 0 }}>
                <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>close</span>
              </button>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
        <button type="button" onClick={addLine}
          style={{ display: "flex", alignItems: "center", gap: "4px", border: "1px solid #e4e2e1", borderRadius: "8px", background: "white", color: "#333333", fontSize: "12px", fontWeight: "bold", padding: "8px 12px", cursor: "pointer" }}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>add</span>
          Add service
        </button>
        <div style={{ textAlign: "right" }}>
          <span style={{ fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", color: "#999999", marginRight: "10px" }}>PO Value</span>
          <span style={{ fontSize: "20px", fontWeight: "bold", color: "#e30613" }}>{inr(total)}</span>
        </div>
      </div>
    </div>
  );
}
