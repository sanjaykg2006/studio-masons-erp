import "server-only";

import ExcelJS from "exceljs";

import type {
  BudgetImportPackage,
  BudgetImportPreview,
  ComparisonImportLine,
  ComparisonImportPackage,
  ComparisonImportPreview,
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
const hasWord = (t: string, words: string[]) => words.some((w) => norm(t).includes(w));

const DESC = ["description", "particular", "nomenclature", "scope"];
const QTY = ["qty", "quantity"];
const UNIT = ["unit", "uom", "u.o.m"];
const REF = ["boq ref", "ref", "boq code", "item code"];

const SKIP_SHEET = ["summary", "cost summary", "m sheet", "measurement"];
const isSkippableSheet = (name: string) => SKIP_SHEET.some((k) => norm(name).includes(k));
const isTotalRow = (desc: string) => hasWord(desc, ["total"]);
const isOnlyNumber = (desc: string) => /^[\d.,\s-]+$/.test(desc.trim());

/** Row values as a 1-indexed array of raw cell values (index 0 unused). */
function rowValues(row: ExcelJS.Row): ExcelJS.CellValue[] {
  const out: ExcelJS.CellValue[] = [];
  row.eachCell({ includeEmpty: true }, (cell, col) => {
    out[col] = cell.value;
  });
  return out;
}

type FixedCols = { ref: number; desc: number; unit: number; qty: number };

/** Find the header row (has a Description column AND a Qty column) within the
 * first `scan` rows, returning its index + the fixed column positions. */
function findHeader(ws: ExcelJS.Worksheet, scan = 20): { row: number; cols: FixedCols } | null {
  const last = Math.min(ws.rowCount, scan);
  for (let r = 1; r <= last; r++) {
    const vals = rowValues(ws.getRow(r));
    let desc = 0;
    let qty = 0;
    let unit = 0;
    let ref = 0;
    for (let c = 1; c < vals.length; c++) {
      const t = cellText(vals[c]);
      if (!t) continue;
      if (!desc && hasWord(t, DESC)) desc = c;
      else if (!qty && hasWord(t, QTY)) qty = c;
      else if (!unit && hasWord(t, UNIT)) unit = c;
      else if (!ref && hasWord(t, REF)) ref = c;
    }
    if (desc && qty) return { row: r, cols: { ref, desc, unit, qty } };
  }
  return null;
}

// ── Budget BOQ ───────────────────────────────────────────────────────────────

export async function parseBudgetWorkbook(buffer: ArrayBuffer): Promise<BudgetImportPreview> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const packages: BudgetImportPackage[] = [];
  const warnings: string[] = [];

  wb.eachSheet((ws) => {
    if (ws.state === "hidden" || ws.state === "veryHidden") return;
    if (isSkippableSheet(ws.name)) return;

    const header = findHeader(ws);
    if (!header) {
      warnings.push(`Sheet "${ws.name}" skipped — no Description/Qty header found.`);
      return;
    }
    const { desc, qty, unit, ref } = header.cols;
    const lines: BudgetImportPackage["lines"] = [];
    for (let r = header.row + 1; r <= ws.rowCount; r++) {
      const vals = rowValues(ws.getRow(r));
      const description = cellText(vals[desc]);
      if (!description || isTotalRow(description) || isOnlyNumber(description)) continue;
      const q = cellNum(vals[qty]);
      if (q == null) continue; // spec paragraph / non-line row
      const rateCol = qty + 1; // Rate sits just after Qty in the standard format
      lines.push({
        ref: ref ? cellText(vals[ref]) || null : null,
        description,
        unit: unit ? cellText(vals[unit]) || null : null,
        qty: q,
        rate: cellNum(vals[rateCol]) ?? 0,
      });
    }
    if (lines.length === 0) {
      warnings.push(`Sheet "${ws.name}" skipped — no priced lines found.`);
      return;
    }
    packages.push({
      name: ws.name,
      lines,
      total: lines.reduce((s, l) => s + l.qty * l.rate, 0),
    });
  });

  if (packages.length === 0) warnings.push("No importable packages were found in this workbook.");
  return { packages, warnings };
}

// ── Comparison BOQ ───────────────────────────────────────────────────────────

/** Locate the sub-header row carrying the repeating Rate/Amount blocks. */
function findRateBlocks(
  ws: ExcelJS.Worksheet,
  headerRow: number
): { subRow: number; blocks: { name: string; rateCol: number; makeCol: number | null }[] } | null {
  // The Rate/Amount headers are on the header row or the row just below it.
  for (const sub of [headerRow, headerRow + 1]) {
    const vals = rowValues(ws.getRow(sub));
    const rateCols: number[] = [];
    let makeAny = false;
    for (let c = 1; c < vals.length; c++) {
      const t = norm(cellText(vals[c]));
      if (t === "rate" || t.endsWith(" rate") || t.includes("rate")) rateCols.push(c);
      if (t.includes("make") || t.includes("brand")) makeAny = true;
    }
    if (rateCols.length >= 1) {
      const nameRow = sub > headerRow ? rowValues(ws.getRow(sub - 1)) : vals;
      const blocks = rateCols.map((rateCol) => {
        // Two-row header: block name sits above the rate column (merge master).
        let name = cellText(nameRow[rateCol]);
        if (!name) {
          // Inline layout B: strip a trailing "rate" from the header text.
          name = cellText(vals[rateCol]).replace(/rate$/i, "").trim();
        }
        const makeCol = makeAny && vals[rateCol + 2] && norm(cellText(vals[rateCol + 2])).includes("make")
          ? rateCol + 2
          : null;
        return { name: name || `Block ${rateCol}`, rateCol, makeCol };
      });
      return { subRow: sub, blocks };
    }
  }
  return null;
}

export async function parseComparisonWorkbook(buffer: ArrayBuffer): Promise<ComparisonImportPreview> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const packages: ComparisonImportPackage[] = [];
  const warnings: string[] = [];
  const vendorSet = new Set<string>();

  wb.eachSheet((ws) => {
    if (ws.state === "hidden" || ws.state === "veryHidden") return;
    if (isSkippableSheet(ws.name) || norm(ws.name).includes("comparison summary")) return;

    const header = findHeader(ws);
    if (!header) {
      warnings.push(`Sheet "${ws.name}" skipped — no Description/Qty header found.`);
      return;
    }
    const rb = findRateBlocks(ws, header.row);
    if (!rb || rb.blocks.length < 1) {
      warnings.push(`Sheet "${ws.name}" skipped — no vendor rate columns found.`);
      return;
    }
    // First "budget" block is the reference; the rest are vendors.
    const budgetIdx = rb.blocks.findIndex((b) => norm(b.name) === "budget");
    const vendorBlocks = rb.blocks.filter((_, i) => i !== (budgetIdx === -1 ? -2 : budgetIdx));
    if (vendorBlocks.length === 0) {
      warnings.push(`Sheet "${ws.name}" skipped — only a budget column, no vendors.`);
      return;
    }
    vendorBlocks.forEach((b) => vendorSet.add(b.name));

    const { desc, qty, unit, ref } = header.cols;
    const dataStart = Math.max(header.row, rb.subRow) + 1;
    const lines: ComparisonImportLine[] = [];
    for (let r = dataStart; r <= ws.rowCount; r++) {
      const vals = rowValues(ws.getRow(r));
      const description = cellText(vals[desc]);
      if (!description || isTotalRow(description) || isOnlyNumber(description)) continue;
      const q = cellNum(vals[qty]);
      if (q == null) continue;
      const quotes = vendorBlocks
        .map((b) => ({
          vendor: b.name,
          rate: cellNum(vals[b.rateCol]),
          make: b.makeCol ? cellText(vals[b.makeCol]) || null : null,
        }))
        .filter((qt): qt is { vendor: string; rate: number; make: string | null } => qt.rate != null);
      lines.push({
        ref: ref ? cellText(vals[ref]) || null : null,
        description,
        unit: unit ? cellText(vals[unit]) || null : null,
        qty: q,
        quotes,
      });
    }
    if (lines.length === 0) {
      warnings.push(`Sheet "${ws.name}" skipped — no priced lines found.`);
      return;
    }
    packages.push({ name: ws.name, vendors: vendorBlocks.map((b) => b.name), lines });
  });

  if (packages.length === 0) warnings.push("No importable packages were found in this workbook.");
  return { packages, vendorMatches: [...vendorSet].map((name) => ({ name, vendor_id: null })), warnings };
}
