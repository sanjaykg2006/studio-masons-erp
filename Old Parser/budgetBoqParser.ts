"use client";
// Multi-sheet Budget BOQ parser. Real consolidated BOQs (e.g. the Indegene file)
// carry one sheet per package plus summary/measurement sheets, varied header
// layouts, and split supply/installation rate columns. This reads EVERY sheet,
// best-effort detects its columns, auto-flags non-line-item sheets to skip, and
// treats each remaining sheet as a package (packageName = sheet name). The QS
// reviews the result before release — see BudgetBoqTab.
import * as XLSX from "xlsx";

export type ParsedBudgetLine = {
  item: string;
  unit: string;
  budgetedQty: number;
  supplyRate?: number;
  installRate?: number;
  rate: number;   // effective combined rate
  amount: number;
};

export type ParsedSheet = {
  sheetName: string;
  suggestedPackage: string;
  skipped: boolean;          // auto-suggestion; the QS can override in review
  skipReason?: string;
  rateMode: "single" | "split" | "none";
  columnNote: string;        // human summary of what was detected
  lines: ParsedBudgetLine[];
  // Self-reconciliation: the sum of the parsed line amounts vs the sheet's own
  // stated total (grand total, else the sum of its section subtotals). "unchecked"
  // when the sheet carries no usable total row. Non-blocking — surfaced for review.
  parsedTotal: number;
  statedTotal: number | null;
  reconciled: "ok" | "mismatch" | "unchecked";
};

// Defaults for sheets that are skipped before any line parsing.
const NO_RECON = { parsedTotal: 0, statedTotal: null as number | null, reconciled: "unchecked" as const };

const norm = (v: unknown) => String(v ?? "").toLowerCase().replace(/\s+/g, " ").trim();

// Strong vs weak description keywords; "item"/"work" are weak because "Item No"
// and "Total Amount" can masquerade as them.
const DESC_STRONG = ["description", "particular", "nomenclature", "scope", "of work"];
const DESC_WEAK = ["item", "service", "work"];
const SERIAL_HEADERS = ["item no", "item no.", "sl no", "sl.no", "s.no", "s no", "sno", "si no", "s.l", "sl", "s no.", "version"];

// Roll-up rows that aren't real line items: "Total", "Sub Total", "Grand Total",
// "Total Modular", "Sub Total Carried to Summary", "GST", etc. These carry an
// amount but no procurable item, so they must be excluded on every sheet. A long
// description that merely contains the word "total" is left alone (≤ 44 chars
// keeps it to short total labels, not spec sentences).
function isTotalRow(item: string): boolean {
  const t = item.toLowerCase().replace(/\s+/g, " ").trim();
  if (/carried (to|forward)/.test(t)) return true;
  // Starts with a total label — covers "Total", "TOTAL AMOUNT", "Total Modular" and
  // long section totals like "Total Amount Section-4 ( Fire Sprinkler System )"
  // regardless of length, so a section subtotal row is never summed as a line item.
  if (/^(sub ?-? ?total|subtotal|grand ?total|g\.? ?total|say total|total)\b/.test(t)) return true;
  // Subtotal / grand total appearing mid-line.
  if (/\b(sub ?-? ?total|subtotal|grand ?total)\b/.test(t)) return true;
  if (/^(gst|igst|cgst|sgst|round ?off)\b/.test(t)) return true;
  return false;
}

function cleanNum(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function findDescCol(cells: string[]): number {
  const isSerial = (h: string) => SERIAL_HEADERS.includes(h);
  // Prefer a strong keyword that isn't a serial-number header.
  for (let i = 0; i < cells.length; i++) {
    const h = norm(cells[i]);
    if (h && DESC_STRONG.some((k) => h.includes(k)) && !isSerial(h)) return i;
  }
  for (let i = 0; i < cells.length; i++) {
    const h = norm(cells[i]);
    if (h && DESC_WEAK.some((k) => h.includes(k)) && !isSerial(h)) return i;
  }
  return -1;
}

function findCol(cells: string[], test: (h: string) => boolean): number {
  return cells.findIndex((c) => { const h = norm(c); return !!h && test(h); });
}

// A qty column is one whose header mentions qty/quantity/nos, or a bare "total"
// that is not a money column (so the C&I "TOTAL" qty is caught, "TOTAL AMOUNT" isn't).
function findQtyCol(cells: string[]): number {
  const direct = findCol(cells, (h) => h.includes("qty") || h.includes("quantity") || h === "nos" || h.includes("nos."));
  if (direct !== -1) return direct;
  return findCol(cells, (h) => h.includes("total") && !h.includes("amount") && !h.includes("amt") && !h.includes("value"));
}

export async function parseBudgetWorkbook(file: File): Promise<ParsedSheet[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const out: ParsedSheet[] = [];
  // Per-sheet visibility metadata (Hidden: 0 = visible, 1 = hidden, 2 = very hidden).
  const visibility = wb.Workbook?.Sheets ?? [];

  for (let si = 0; si < wb.SheetNames.length; si++) {
    const sheetName = wb.SheetNames[si];
    const sheet = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });
    const nameNorm = norm(sheetName);

    // Auto-skip sheets hidden in the workbook — the user doesn't see these (e.g. the
    // duplicate "- Indegene" working copies), so they shouldn't import by default.
    if (visibility[si]?.Hidden) {
      out.push({ sheetName, suggestedPackage: sheetName.trim(), skipped: true, skipReason: "Hidden in the workbook", rateMode: "none", columnNote: "—", lines: [], ...NO_RECON });
      continue;
    }

    // Auto-skip obvious non-line-item sheets by name.
    if (/summary|measurement|^m sheet|cost-?summary/.test(nameNorm)) {
      out.push({ sheetName, suggestedPackage: sheetName.trim(), skipped: true, skipReason: "Looks like a summary / measurement sheet", rateMode: "none", columnNote: "—", lines: [], ...NO_RECON });
      continue;
    }

    // Locate the header row: a description-ish column plus a qty / rate / amount.
    let headerIdx = -1, descCol = -1, unitCol = -1, qtyCol = -1, amountCol = -1;
    let supplyCol = -1, installCol = -1, singleRateCol = -1;
    let supplyAmtCol = -1, installAmtCol = -1; // split "Total Amount (Supply/Installation)" columns
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const cells = rows[i].map((c) => String(c ?? ""));
      const d = findDescCol(cells);
      if (d === -1) continue;
      const q = findQtyCol(cells);
      const rateLike = findCol(cells, (h) => h.includes("rate") || h.includes("price"));
      const amt = findCol(cells, (h) => h.includes("amount"));
      if (q === -1 && rateLike === -1 && amt === -1) continue;

      headerIdx = i; descCol = d; qtyCol = q;
      unitCol = findCol(cells, (h) => h.includes("unit") || h.includes("uom") || h === "u.o.m");
      amountCol = findCol(cells, (h) => h.includes("amount") && !h.includes("rate"));
      // Split amount columns — "Total Amount (Supply)" + "Total Amount (Installation)".
      supplyAmtCol = findCol(cells, (h) => h.includes("amount") && (h.includes("supply") || h.includes("suply")));
      installAmtCol = findCol(cells, (h) => h.includes("amount") && h.includes("install"));
      // Split supply / installation rate columns (tolerate the "suply" misspelling).
      supplyCol = findCol(cells, (h) => (h.includes("supply") || h.includes("suply")) && h.includes("rate"));
      installCol = findCol(cells, (h) => h.includes("install") && h.includes("rate"));
      // Two-row header: a "Rate" and/or "Amount" header with "Supply | Installation"
      // split on the row beneath (ACS / CCTV / IT). Each split pair is assigned to
      // rate vs amount by header position. Array.from densifies sparse holes; long
      // cells (description text like "Supply and installation of…") are ignored.
      if (i + 1 < rows.length && ((supplyCol === -1 && installCol === -1) || (supplyAmtCol === -1 && installAmtCol === -1))) {
        const sub = Array.from(rows[i + 1] ?? [], (c) => norm(c));
        const supplyIdx: number[] = []; const installIdx: number[] = [];
        sub.forEach((h, idx) => {
          if (h.length > 18) return;
          if (h.includes("supply") || h.includes("suply")) supplyIdx.push(idx);
          else if (h.includes("install")) installIdx.push(idx);
        });
        const pick = (idxs: number[], lo: number, hi: number) => idxs.find((x) => x >= lo && (hi === -1 || x < hi)) ?? -1;
        // Rate split lives between the "Rate" header and the "Amount" header.
        if (supplyCol === -1 && installCol === -1 && rateLike !== -1) {
          const hi = amt > rateLike ? amt : -1;
          const rs = pick(supplyIdx, rateLike, hi); const ri = pick(installIdx, rateLike, hi);
          if (rs !== -1 && ri !== -1) { supplyCol = rs; installCol = ri; }
        }
        // Amount split lives at or after the "Amount" header.
        if (supplyAmtCol === -1 && installAmtCol === -1 && amt !== -1) {
          const as = pick(supplyIdx, amt, -1); const ai = pick(installIdx, amt, -1);
          if (as !== -1 && ai !== -1) { supplyAmtCol = as; installAmtCol = ai; }
        }
      }
      if (supplyCol === -1 && installCol === -1) {
        // Single rate: prefer an exact "rate" over "basic rate".
        singleRateCol = findCol(cells, (h) => (h === "rate" || h === "rate ") );
        if (singleRateCol === -1) singleRateCol = findCol(cells, (h) => (h.includes("rate") || h.includes("price")) && !h.includes("basic") && !h.includes("per sqft") && !h.includes("per sq"));
        if (singleRateCol === -1) singleRateCol = rateLike;
      }
      break;
    }

    if (headerIdx === -1) {
      out.push({ sheetName, suggestedPackage: sheetName.trim(), skipped: true, skipReason: "No BOQ header row found", rateMode: "none", columnNote: "—", lines: [], ...NO_RECON });
      continue;
    }

    const rateMode: ParsedSheet["rateMode"] = supplyCol !== -1 && installCol !== -1 ? "split" : singleRateCol !== -1 ? "single" : "none";
    // Amount on any row, using the same column logic the line items use.
    const rowAmount = (cells: unknown[], qty: number, rate: number) =>
      supplyAmtCol !== -1 && installAmtCol !== -1
        ? cleanNum(cells[supplyAmtCol]) + cleanNum(cells[installAmtCol])
        : amountCol !== -1 ? cleanNum(cells[amountCol]) : qty * rate;
    const lines: ParsedBudgetLine[] = [];
    const totals: { label: string; amount: number }[] = []; // captured total/subtotal rows
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const cells = rows[i];
      const item = String(cells[descCol] ?? "").trim();
      if (!item || item.length < 2) continue;
      if (/^\d+(\.\d+)?$/.test(item)) continue; // stray serial number leaked into desc
      if (isTotalRow(item)) {
        // Capture the sheet's own totals for reconciliation, ignoring GST / tax-
        // inclusive rows (those exceed the ex-GST line sum).
        const lbl = item.toLowerCase().replace(/\s+/g, " ").trim();
        if (!/gst|incl|including|with tax|tax\b/.test(lbl)) {
          const ta = rowAmount(cells, 0, 0);
          if (ta > 0) totals.push({ label: lbl, amount: ta });
        }
        continue; // subtotal / total / carried-to-summary roll-ups are never line items
      }
      const qty = qtyCol !== -1 ? cleanNum(cells[qtyCol]) : 0;
      const supply = supplyCol !== -1 ? cleanNum(cells[supplyCol]) : undefined;
      const install = installCol !== -1 ? cleanNum(cells[installCol]) : undefined;
      const rate = rateMode === "split" ? (supply ?? 0) + (install ?? 0) : singleRateCol !== -1 ? cleanNum(cells[singleRateCol]) : 0;
      // Clubs supply + installation amounts when split; else single amount column,
      // else qty × combined rate.
      const amount = rowAmount(cells, qty, rate);
      // Skip section headings / spec paragraphs: no qty, no rate, no amount.
      if (!qty && !rate && !amount) continue;
      lines.push({ item, unit: unitCol !== -1 ? String(cells[unitCol] ?? "").trim() : "", budgetedQty: qty, supplyRate: supply, installRate: install, rate, amount });
    }

    const parts = [`desc col ${descCol}`, unitCol !== -1 ? "unit" : "no unit", qtyCol !== -1 ? "qty" : "no qty",
      rateMode === "split" ? "supply+install rate" : rateMode === "single" ? "rate" : "no rate", amountCol !== -1 ? "amount" : "computed amount"];

    // Reconcile: the stated total is the grand total when one is labelled (the
    // largest such), else the sum of the sheet's section subtotals. Compared to the
    // parsed line sum within a small tolerance.
    const parsedTotal = lines.reduce((s, l) => s + l.amount, 0);
    const grands = totals.filter((t) => /grand/.test(t.label)).map((t) => t.amount);
    const statedTotal = grands.length
      ? Math.max(...grands)
      : totals.length ? totals.reduce((s, t) => s + t.amount, 0) : null;
    const tol = statedTotal == null ? 0 : Math.max(2, statedTotal * 0.005);
    const reconciled: ParsedSheet["reconciled"] = statedTotal == null ? "unchecked"
      : Math.abs(parsedTotal - statedTotal) <= tol ? "ok" : "mismatch";

    out.push({
      sheetName,
      suggestedPackage: sheetName.trim(),
      skipped: lines.length === 0,
      skipReason: lines.length === 0 ? "No priced line items found" : undefined,
      rateMode,
      columnNote: parts.join(" · "),
      lines,
      parsedTotal,
      statedTotal,
      reconciled,
    });
  }

  return out;
}
