"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "@/lib/toast";
import { parseBudgetWorkbook, type ParsedSheet } from "./budgetBoqParser";
import { uploadFileToStorage, openDocument, isStored, docName } from "../docs";
import {
  loadBudgetBoq,
  saveBudgetBoqDraft,
  releaseBudgetBoq,
  deleteBudgetBoq,
  setLinePackage,
  type BudgetBoqDTO,
  type BudgetLineInput,
} from "./procurement";

const card: React.CSSProperties = { background: "white", border: "1px solid #e4e2e1", borderRadius: "12px", padding: "24px" };
const cell: React.CSSProperties = { padding: "8px 10px", fontSize: "13px", color: "#333333", borderBottom: "1px solid #f0eeed" };
const th: React.CSSProperties = { ...cell, fontSize: "10px", fontWeight: "bold", textTransform: "uppercase", color: "#999999", textAlign: "left" };
const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// A sheet in the review step: the parsed result plus the QS's include/rename overrides.
type ReviewSheet = ParsedSheet & { include: boolean; packageName: string };

export default function BudgetBoqTab({ projectId, projectName, role }: { projectId: string; projectName: string; role: string }) {
  const toast = useToast();
  const [boq, setBoq] = useState<BudgetBoqDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  // Multi-sheet review state, held until the QS confirms the import.
  const [review, setReview] = useState<ReviewSheet[] | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const isQs = role === "SENIOR_QS" || role === "ADMIN";
  const isProc = role === "PROCUREMENT_MANAGER" || role === "ADMIN";
  const released = boq?.status === "RELEASED";
  const hasSplit = useMemo(() => !!boq?.lines.some((l) => l.supplyRate != null || l.installRate != null), [boq]);

  useEffect(() => {
    if (!projectId) return;
    loadBudgetBoq(projectId).then(setBoq).catch(() => setBoq(null));
  }, [projectId]);

  // Step 1 — parse every sheet and open the review (nothing is saved yet).
  async function importFile(file: File) {
    setBusy(true);
    try {
      const sheets = await parseBudgetWorkbook(file);
      if (sheets.length === 0) throw new Error("The workbook has no sheets.");
      setReview(sheets.map((s) => ({ ...s, include: !s.skipped, packageName: s.suggestedPackage })));
      setPendingFile(file);
      const usable = sheets.filter((s) => !s.skipped).length;
      toast.info("Review the sheets", `${sheets.length} sheets read — ${usable} look like line-item packages. Confirm before release.`);
    } catch (err) {
      toast.warning("Couldn't read the workbook", err instanceof Error ? err.message : "The file couldn't be parsed.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  // Step 2 — flatten the included sheets into package-tagged lines and persist.
  async function confirmImport() {
    if (!review || !pendingFile) return;
    const chosen = review.filter((s) => s.include && s.lines.length > 0);
    if (chosen.length === 0) { toast.warning("Nothing to import", "Tick at least one sheet with line items."); return; }
    const lines: BudgetLineInput[] = chosen.flatMap((s) =>
      s.lines.map((l) => ({
        packageName: s.packageName.trim() || s.sheetName,
        item: l.item,
        unit: l.unit,
        budgetedQty: l.budgetedQty,
        rate: l.rate,
        supplyRate: l.supplyRate,
        installRate: l.installRate,
        amount: l.amount,
      })),
    );
    setBusy(true);
    try {
      const path = await uploadFileToStorage(pendingFile, "budget-boq");
      const saved = await saveBudgetBoqDraft({ projectId, projectName, fileName: path, lines });
      setBoq(saved);
      setReview(null); setPendingFile(null);
      toast.success("Budget BOQ imported", `${lines.length} lines across ${chosen.length} packages. Review and release when ready.`);
    } catch (err) {
      toast.warning("Couldn't import", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Wipe the project's budget BOQ (even if released) so a corrected workbook can be
  // re-imported — the previous import keeps its (possibly stale) stored amounts.
  async function replaceBudget() {
    if (!boq) return;
    if (!confirm("Delete the current budget BOQ and start a fresh import? This removes all its lines (including a released baseline).")) return;
    setBusy(true);
    try {
      await deleteBudgetBoq(projectId);
      setBoq(null); setReview(null); setPendingFile(null);
      toast.success("Budget BOQ cleared", "Upload the workbook again to re-import with the latest parsing.");
    } catch (err) {
      toast.warning("Couldn't clear", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!boq) return;
    if (!confirm("Release the budget BOQ? Quantities lock and become the baseline for all purchase intents.")) return;
    setBusy(true);
    try {
      setBoq(await releaseBudgetBoq(boq.id));
      toast.success("Budget BOQ released", "It is now the locked baseline for purchase intents.");
    } catch (err) {
      toast.warning("Couldn't release", err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function savePackage(lineId: string, value: string) {
    try {
      await setLinePackage(lineId, value);
      setBoq((b) => (b ? { ...b, lines: b.lines.map((l) => (l.id === lineId ? { ...l, packageName: value || null } : l)) } : b));
    } catch (err) {
      toast.warning("Couldn't save package", err instanceof Error ? err.message : "Try again.");
    }
  }

  const total = boq?.lines.reduce((s, l) => s + l.amount, 0) ?? 0;
  // Package roll-up for the released/draft view.
  const packages = useMemo(() => {
    const map = new Map<string, { lines: number; amount: number }>();
    boq?.lines.forEach((l) => {
      const k = l.packageName ?? "—";
      const e = map.get(k) ?? { lines: 0, amount: 0 };
      e.lines++; e.amount += l.amount; map.set(k, e);
    });
    return [...map.entries()];
  }, [boq]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "16px", flexWrap: "wrap" }}>
          <div>
            <h3 style={{ fontSize: "16px", fontWeight: "bold", color: "#333333" }}>Budget BOQ — {projectName || "the project"}</h3>
            <p style={{ fontSize: "13px", color: "#999999", marginTop: "4px", maxWidth: "560px", lineHeight: 1.5 }}>
              The Senior QS Engineer releases the budget BOQ — the locked baseline that gates every purchase intent.
              Each worksheet is imported as its own package; summary and measurement sheets are skipped.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {isStored(boq?.fileName) && (
              <button type="button" onClick={() => openDocument(boq!.fileName!).catch((e) => toast.warning("Couldn't open file", e instanceof Error ? e.message : "Try again."))}
                style={{ display: "inline-flex", alignItems: "center", gap: "4px", border: "1px solid #e4e2e1", borderRadius: "6px", background: "white", color: "#0059a8", fontSize: "11px", fontWeight: "bold", padding: "4px 10px", cursor: "pointer" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>description</span>
                {docName(boq?.fileName)}
              </button>
            )}
            {isQs && boq && (
              <button type="button" onClick={replaceBudget} disabled={busy}
                style={{ display: "inline-flex", alignItems: "center", gap: "4px", border: "1px solid #ba1a1a", borderRadius: "6px", background: "white", color: "#ba1a1a", fontSize: "11px", fontWeight: "bold", padding: "4px 10px", cursor: busy ? "wait" : "pointer" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>restart_alt</span>
                Replace / re-import
              </button>
            )}
            <span style={{ fontSize: "11px", fontWeight: "bold", padding: "4px 10px", borderRadius: "999px", background: released ? "rgba(22,163,74,0.1)" : "rgba(0,89,168,0.1)", color: released ? "#16a34a" : "#0059a8" }}>
              {boq ? (released ? "RELEASED · LOCKED" : "DRAFT") : "NOT CREATED"}
            </span>
          </div>
        </div>

        {isQs && !released && (
          <div style={{ marginTop: "16px", background: "#f8f8f8", border: "1px dashed #d4d2d1", borderRadius: "8px", padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
            <div style={{ fontSize: "12px", color: "#666666" }}>Import an Excel BOQ (.xlsx). Every worksheet is read; you confirm which become packages before release.</div>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); }} />
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
              style={{ display: "flex", alignItems: "center", gap: "6px", border: "1px solid #e4e2e1", borderRadius: "8px", background: "white", color: "#333333", fontSize: "12px", fontWeight: "bold", padding: "9px 14px", cursor: busy ? "wait" : "pointer", whiteSpace: "nowrap" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>upload_file</span>
              {busy ? "Working…" : boq ? "Re-import BOQ" : "Upload Budget BOQ"}
            </button>
          </div>
        )}
        {!isQs && !boq && <p style={{ marginTop: "16px", fontSize: "13px", color: "#999999" }}>Waiting for the Senior QS Engineer to upload the budget BOQ.</p>}
      </div>

      {/* Step 1 review — confirm packages before importing */}
      {review && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px", flexWrap: "wrap", gap: "10px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: "bold", color: "#333333" }}>Review sheets &amp; packages</h3>
            <div style={{ display: "flex", gap: "10px" }}>
              <button onClick={() => { setReview(null); setPendingFile(null); }} disabled={busy}
                style={{ border: "1px solid #e4e2e1", borderRadius: "8px", background: "white", color: "#333333", fontSize: "13px", fontWeight: "bold", padding: "8px 16px", cursor: "pointer" }}>Cancel</button>
              <button onClick={confirmImport} disabled={busy}
                style={{ border: "none", borderRadius: "8px", background: "#e30613", color: "white", fontSize: "13px", fontWeight: "bold", padding: "8px 18px", cursor: busy ? "wait" : "pointer" }}>
                {busy ? "Importing…" : `Import ${review.filter((s) => s.include && s.lines.length).reduce((n, s) => n + s.lines.length, 0)} lines`}
              </button>
            </div>
          </div>
          <p style={{ fontSize: "12px", color: "#999999", marginBottom: "14px" }}>Untick sheets you don&apos;t want, and rename the package label per sheet. Summary / measurement sheets are pre-unticked. &quot;Total vs sheet&quot; cross-checks the parsed total against each sheet&apos;s own total.</p>
          {review.some((s) => s.include && s.reconciled === "mismatch") && (
            <div style={{ marginBottom: "14px", padding: "10px 12px", background: "rgba(186,26,26,0.07)", borderRadius: "8px", fontSize: "12px", color: "#ba1a1a", display: "flex", gap: "8px", alignItems: "flex-start" }}>
              <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>warning</span>
              <span>Some ticked sheets&apos; parsed totals don&apos;t match the sheet&apos;s own stated total. Review the flagged rows (⚠) before importing — the parse may be picking up the wrong column or a stray row.</span>
            </div>
          )}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>
                <th style={{ ...th, width: "40px" }}>Use</th><th style={th}>Sheet</th><th style={th}>Package name</th>
                <th style={{ ...th, textAlign: "right" }}>Lines</th>
                <th style={{ ...th, textAlign: "right" }}>Total vs sheet</th>
                <th style={th}>Detected</th>
              </tr></thead>
              <tbody>
                {review.map((s, i) => (
                  <tr key={s.sheetName} style={{ opacity: s.include ? 1 : 0.5 }}>
                    <td style={cell}>
                      <input type="checkbox" checked={s.include} disabled={s.lines.length === 0}
                        onChange={(e) => setReview((r) => r!.map((x, idx) => idx === i ? { ...x, include: e.target.checked } : x))} />
                    </td>
                    <td style={cell}>{s.sheetName}</td>
                    <td style={cell}>
                      <input value={s.packageName} disabled={!s.include}
                        onChange={(e) => setReview((r) => r!.map((x, idx) => idx === i ? { ...x, packageName: e.target.value } : x))}
                        style={{ width: "180px", padding: "4px 8px", border: "1px solid #e4e2e1", borderRadius: "6px", fontSize: "12px" }} />
                    </td>
                    <td style={{ ...cell, textAlign: "right", fontWeight: "bold", color: s.lines.length ? "#333333" : "#bbbbbb" }}>{s.lines.length}</td>
                    <td style={{ ...cell, fontSize: "11px", textAlign: "right", whiteSpace: "nowrap" }}>
                      {s.reconciled === "ok" ? (
                        <span style={{ color: "#16a34a", fontWeight: "bold" }} title="Parsed total matches the sheet's own total">✓ {inr(s.parsedTotal)}</span>
                      ) : s.reconciled === "mismatch" ? (
                        <span style={{ color: "#ba1a1a", fontWeight: "bold" }} title={`Parsed ${inr(s.parsedTotal)} vs the sheet's stated total ${inr(s.statedTotal ?? 0)}`}>⚠ {inr(s.parsedTotal)} ≠ {inr(s.statedTotal ?? 0)}</span>
                      ) : (
                        <span style={{ color: "#bbbbbb" }}>—</span>
                      )}
                    </td>
                    <td style={{ ...cell, fontSize: "11px", color: s.skipReason ? "#a36200" : "#666666" }}>
                      {s.skipReason ?? s.columnNote}{s.rateMode === "split" ? " · supply+install" : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Imported / released lines */}
      {boq && boq.lines.length > 0 && !review && (
        <div style={card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", flexWrap: "wrap", gap: "10px" }}>
            <h3 style={{ fontSize: "14px", fontWeight: "bold", color: "#333333" }}>{packages.length} packages · {boq.lines.length} lines · {inr(total)}</h3>
            {isQs && !released && (
              <button onClick={release} disabled={busy}
                style={{ display: "flex", alignItems: "center", gap: "6px", border: "none", borderRadius: "8px", background: "#16a34a", color: "white", fontSize: "13px", fontWeight: "bold", padding: "9px 16px", cursor: busy ? "wait" : "pointer" }}>
                <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>lock</span> Release &amp; Lock
              </button>
            )}
          </div>
          {/* Package roll-up */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", marginBottom: "16px" }}>
            {packages.map(([name, e]) => (
              <span key={name} style={{ fontSize: "11px", color: "#333333", background: "#f4f4f4", border: "1px solid #e4e2e1", borderRadius: "999px", padding: "4px 10px" }}>
                {name} <span style={{ color: "#999999" }}>· {e.lines} · {inr(e.amount)}</span>
              </span>
            ))}
          </div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Package</th><th style={th}>Item</th><th style={th}>Unit</th>
                  <th style={{ ...th, textAlign: "right" }}>Budgeted</th>
                  {released && <th style={{ ...th, textAlign: "right" }}>Committed</th>}
                  {released && <th style={{ ...th, textAlign: "right" }}>Remaining</th>}
                  {hasSplit && <th style={{ ...th, textAlign: "right" }}>Supply</th>}
                  {hasSplit && <th style={{ ...th, textAlign: "right" }}>Install</th>}
                  <th style={{ ...th, textAlign: "right" }}>Rate</th>
                  <th style={{ ...th, textAlign: "right" }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {boq.lines.map((l) => (
                  <tr key={l.id}>
                    <td style={cell}>
                      {released && isProc ? (
                        <input defaultValue={l.packageName ?? ""} placeholder="Package"
                          onBlur={(e) => { if (e.target.value !== (l.packageName ?? "")) savePackage(l.id, e.target.value); }}
                          style={{ width: "130px", padding: "4px 8px", border: "1px solid #e4e2e1", borderRadius: "6px", fontSize: "12px" }} />
                      ) : (l.packageName ?? "—")}
                    </td>
                    <td style={cell}>{l.item}</td>
                    <td style={cell}>{l.unit || "—"}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{l.budgetedQty}</td>
                    {released && <td style={{ ...cell, textAlign: "right", color: l.committedQty > 0 ? "#0059a8" : "#999999" }}>{l.committedQty}</td>}
                    {released && <td style={{ ...cell, textAlign: "right", fontWeight: "bold", color: l.remainingQty <= 0 ? "#ba1a1a" : "#16a34a" }}>{l.remainingQty}</td>}
                    {hasSplit && <td style={{ ...cell, textAlign: "right", color: "#666666" }}>{l.supplyRate == null ? "—" : inr(l.supplyRate)}</td>}
                    {hasSplit && <td style={{ ...cell, textAlign: "right", color: "#666666" }}>{l.installRate == null ? "—" : inr(l.installRate)}</td>}
                    <td style={{ ...cell, textAlign: "right" }}>{inr(l.rate)}</td>
                    <td style={{ ...cell, textAlign: "right" }}>{inr(l.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
