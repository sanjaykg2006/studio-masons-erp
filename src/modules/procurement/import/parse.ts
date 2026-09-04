import "server-only";

import ExcelJS from "exceljs";

import type {
  BudgetImportPackage,
  BudgetImportPreview,
  BudgetImportReconcile,
} from "@/modules/procurement/types";

// ── Cell helpers ─────────────────────────────────────────────────────────────

/** A cell's text, flattening exceljs rich-text / formula / hyperlink values. */
function cellText(v: ExcelJS.CellValue): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  const o = v as { richText?: { text: string }[]; text?: unknown; result?: unknown };
  if (Array.isArray(o.richText)) return o.richText.map((r) => r.text).join("").trim();
  if (o.text != null) return String(o.text).trim();
  if (o.result != null) return String(o.result).trim();
  return "";
}

/** A cell's number, tolerating currency symbols and thousands separators. A
 * blank cell returns null (so "no quote" is distinct from 0). */
function cellNum(v: ExcelJS.CellValue): number | null {
  if (v == null || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const o = v as { result?: unknown };
  if (o && typeof o === "object" && "result" in o && typeof o.result === "number") return o.result;
  const s = cellText(v).replace(/[^0-9.\-]/g, "");
  if (s === "" || s === "-" || s === ".") return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

const norm = (s: string) => s.toLowerCase().trim();

const SKIP_SHEET = ["summary", "cost summary", "m sheet", "measurement"];
const isSkippableSheet = (name: string) => SKIP_SHEET.some((k) => norm(name).includes(k));
const isOnlyNumber = (desc: string) => /^[\d.,\s-]+$/.test(desc.trim());

/** Row values as a 1-indexed array of raw cell values (index 0 unused). */
function rowValues(row: ExcelJS.Row): ExcelJS.CellValue[] {
  const out: ExcelJS.CellValue[] = [];
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    out[col] = cell.value;
  });
  return out;
}

// ── Budget BOQ ───────────────────────────────────────────────────────────────
//
// Real consolidated BOQs (e.g. the Indegene file) carry one sheet per package
// with varied header layouts and — crucially — split Supply / Installation rate
// (and sometimes amount) columns. The column detection below is ported from the
// field-tested standalone parser documented in budget-boq-format.docx.
//
// The ERP stores each line as qty + a single rate (the amount is qty × rate). So
// where a sheet states an Amount, we treat that as authoritative and fold it back
// into an *effective rate* (amount ÷ qty) — that way the stored value reproduces
// the sheet's own figure exactly, and installation cost is never dropped.

/** Header row texts, 1-indexed (index 0 unused), lower-cased with runs of
 * whitespace collapsed — so " Total  Qty " matches like "total qty". */
function headerTexts(vals: ExcelJS.CellValue[]): string[] {
  const out: string[] = [];
  for (let c = 1; c < vals.length; c++) out[c] = cellText(vals[c]).toLowerCase().replace(/\s+/g, " ").trim();
  return out;
}
const flat = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
/** First column (1-indexed) whose header passes `test`; -1 if none. */
function findColBy(hdr: string[], test: (h: string) => boolean): number {
  for (let c = 1; c < hdr.length; c++) if (hdr[c] && test(hdr[c])) return c;
  return -1;
}

// Strong vs weak description keywords; "item"/"work" are weak because "Item No"
// and "Total Amount" can masquerade as them. Serial-number headers are excluded.
const DESC_STRONG = ["description", "particular", "nomenclature", "scope", "of work"];
const DESC_WEAK = ["item", "service", "work"];
const SERIAL = ["item no", "item no.", "sl no", "sl.no", "s.no", "s no", "sno", "si no", "s.l", "sl", "version"];

function findDescCol(hdr: string[]): number {
  const isSerial = (h: string) => SERIAL.includes(h);
  const strong = findColBy(hdr, (h) => DESC_STRONG.some((k) => h.includes(k)) && !isSerial(h));
  if (strong !== -1) return strong;
  return findColBy(hdr, (h) => DESC_WEAK.some((k) => h.includes(k)) && !isSerial(h));
}
/** A qty column: header mentions qty / quantity / nos, or a bare "total" that is
 * not a money column (catches the interior "TOTAL" qty; "TOTAL AMOUNT" isn't). */
function findQtyCol(hdr: string[]): number {
  const direct = findColBy(hdr, (h) => h.includes("qty") || h.includes("quantity") || h === "nos" || h.includes("nos."));
  if (direct !== -1) return direct;
  return findColBy(hdr, (h) => h.includes("total") && !h.includes("amount") && !h.includes("amt") && !h.includes("value"));
}

const isTaxRow = (t: string) => /gst|incl|including|with tax|tax\b/.test(t);
/** Roll-up rows that aren't procurable line items — excluded on every sheet. */
function isBudgetTotalRow(t: string): boolean {
  if (/carried (to|forward)/.test(t)) return true;
  if (/^(sub ?-? ?total|subtotal|grand ?total|g\.? ?total|say total|total)\b/.test(t)) return true;
  if (/\b(sub ?-? ?total|subtotal|grand ?total)\b/.test(t)) return true;
  if (/^(gst|igst|cgst|sgst|round ?off)\b/.test(t)) return true;
  return false;
}

export async function parseBudgetWorkbook(buffer: ArrayBuffer): Promise<BudgetImportPreview> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const packages: BudgetImportPackage[] = [];
  const warnings: string[] = [];

  wb.eachSheet((ws) => {
    if (ws.state === "hidden" || ws.state === "veryHidden") return;
    if (isSkippableSheet(ws.name)) return;

    // Locate the header row: a description column plus at least one of qty / rate /
    // amount. Then map every column we understand, including split layouts.
    const scan = Math.min(ws.rowCount, 25);
    let headerRow = -1;
    let descC = -1, unitC = -1, qtyC = -1, refC = -1, amountC = -1;
    let supplyRateC = -1, installRateC = -1, singleRateC = -1;
    let supplyAmtC = -1, installAmtC = -1;
    for (let r = 1; r <= scan; r++) {
      const hdr = headerTexts(rowValues(ws.getRow(r)));
      const d = findDescCol(hdr);
      if (d === -1) continue;
      const q = findQtyCol(hdr);
      const rateLike = findColBy(hdr, (h) => h.includes("rate") || h.includes("price"));
      const amt = findColBy(hdr, (h) => h.includes("amount"));
      if (q === -1 && rateLike === -1 && amt === -1) continue; // not a real header row

      headerRow = r; descC = d; qtyC = q;
      unitC = findColBy(hdr, (h) => h.includes("unit") || h.includes("uom") || h === "u.o.m");
      refC = findColBy(hdr, (h) => h.includes("boq ref") || h.includes("boq code") || h.includes("item code"));
      amountC = findColBy(hdr, (h) => h.includes("amount") && !h.includes("rate"));
      // Split "Total Amount (Supply)" + "(Installation)" columns.
      supplyAmtC = findColBy(hdr, (h) => h.includes("amount") && (h.includes("supply") || h.includes("suply")));
      installAmtC = findColBy(hdr, (h) => h.includes("amount") && h.includes("install"));
      // Split Supply / Installation rate columns (tolerate the "suply" misspelling).
      supplyRateC = findColBy(hdr, (h) => (h.includes("supply") || h.includes("suply")) && h.includes("rate"));
      installRateC = findColBy(hdr, (h) => h.includes("install") && h.includes("rate"));

      // Two-row header: "Rate"/"Amount" on this row, "Supply | Installation" on the
      // row beneath (ACS / CCTV / IT). Assign each split pair to rate vs amount by
      // header position.
      if ((supplyRateC === -1 && installRateC === -1) || (supplyAmtC === -1 && installAmtC === -1)) {
        const sub = headerTexts(rowValues(ws.getRow(r + 1)));
        const supplyIdx: number[] = [], installIdx: number[] = [];
        for (let c = 1; c < sub.length; c++) {
          const h = sub[c];
          if (!h || h.length > 18) continue; // ignore stray description text
          if (h.includes("supply") || h.includes("suply")) supplyIdx.push(c);
          else if (h.includes("install")) installIdx.push(c);
        }
        const pick = (idxs: number[], lo: number, hi: number) => idxs.find((x) => x >= lo && (hi === -1 || x < hi)) ?? -1;
        if (supplyRateC === -1 && installRateC === -1 && rateLike !== -1) {
          const hi = amt > rateLike ? amt : -1; // rate split lives before the amount header
          const rs = pick(supplyIdx, rateLike, hi), ri = pick(installIdx, rateLike, hi);
          if (rs !== -1 && ri !== -1) { supplyRateC = rs; installRateC = ri; }
        }
        if (supplyAmtC === -1 && installAmtC === -1 && amt !== -1) {
          const as = pick(supplyIdx, amt, -1), ai = pick(installIdx, amt, -1);
          if (as !== -1 && ai !== -1) { supplyAmtC = as; installAmtC = ai; }
        }
      }
      if (supplyRateC === -1 && installRateC === -1) {
        // Single rate: prefer an exact "Rate" over "Basic Rate" / "Rate per sqft".
        singleRateC = findColBy(hdr, (h) => h === "rate");
        if (singleRateC === -1)
          singleRateC = findColBy(hdr, (h) => (h.includes("rate") || h.includes("price")) && !h.includes("basic") && !h.includes("per sq"));
        if (singleRateC === -1) singleRateC = rateLike;
      }
      break;
    }

    if (headerRow === -1) {
      warnings.push(`Sheet "${ws.name}" skipped — no Description/Qty header found.`);
      return;
    }

    const split = supplyRateC !== -1 && installRateC !== -1;
    const num = (vals: ExcelJS.CellValue[], c: number) => (c !== -1 ? cellNum(vals[c]) ?? 0 : 0);
    // A row's amount: split supply+installation amount, else the single amount
    // column, else qty × (combined) rate.
    const rowAmount = (vals: ExcelJS.CellValue[], qty: number, rate: number) =>
      supplyAmtC !== -1 && installAmtC !== -1
        ? num(vals, supplyAmtC) + num(vals, installAmtC)
        : amountC !== -1 ? num(vals, amountC) : qty * rate;

    const lines: BudgetImportPackage["lines"] = [];
    const totals: number[] = []; // the sheet's own total/subtotal rows, for the self-check
    let grand: number | null = null;
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const vals = rowValues(ws.getRow(r));
      const item = cellText(vals[descC]);
      if (!item || item.length < 2 || isOnlyNumber(item)) continue;
      const flatItem = flat(item);
      if (isBudgetTotalRow(flatItem)) {
        // Capture the sheet's totals for reconciliation, ignoring GST/tax rows
        // (those exceed the ex-GST line sum).
        if (!isTaxRow(flatItem)) {
          const ta = rowAmount(vals, 0, 0);
          if (ta > 0) { totals.push(ta); if (/grand/.test(flatItem)) grand = Math.max(grand ?? 0, ta); }
        }
        continue;
      }
      const qty = num(vals, qtyC);
      const rate = split ? num(vals, supplyRateC) + num(vals, installRateC) : num(vals, singleRateC);
      const amount = rowAmount(vals, qty, rate);
      if (!qty && !rate && !amount) continue; // section heading / spec paragraph
      // Keep the split the sheet actually stated, alongside the combined figures.
      // Amounts are taken as printed rather than recomputed, so a package always
      // ties back to the source document. Null (not 0) on an unsplit sheet, so a
      // missing column stays distinguishable from a genuine nil quote.
      const splitAmounts = supplyAmtC !== -1 && installAmtC !== -1;
      lines.push({
        ref: refC !== -1 ? cellText(vals[refC]) || null : null,
        description: item,
        unit: unitC !== -1 ? cellText(vals[unitC]) || null : null,
        qty,
        // Fold the authoritative amount into an effective unit rate so qty × rate
        // reproduces the sheet's figure (and clubs installation). Falls back to the
        // combined rate for qty-less / lump-sum lines.
        rate: qty > 0 ? amount / qty : rate,
        supplyRate: split ? num(vals, supplyRateC) : null,
        installRate: split ? num(vals, installRateC) : null,
        supplyAmount: splitAmounts ? num(vals, supplyAmtC) : null,
        installAmount: splitAmounts ? num(vals, installAmtC) : null,
      });
    }

    if (lines.length === 0) {
      warnings.push(`Sheet "${ws.name}" skipped — no priced lines found.`);
      return;
    }

    const total = lines.reduce((s, l) => s + l.qty * l.rate, 0);
    // Stated total = the grand total when labelled (largest), else the sum of the
    // sheet's section subtotals. Compared to the parsed sum within 0.5%.
    const stated = grand != null ? grand : totals.length ? totals.reduce((s, t) => s + t, 0) : null;
    const reconcile: BudgetImportReconcile =
      stated == null
        ? { status: "none" }
        : Math.abs(total - stated) <= Math.max(2, stated * 0.005)
          ? { status: "ok", sheetTotal: stated }
          : { status: "warn", sheetTotal: stated };

    packages.push({ name: ws.name, lines, total, reconcile });
  });

  if (packages.length === 0) warnings.push("No importable packages were found in this workbook.");
  return { packages, warnings };
}
