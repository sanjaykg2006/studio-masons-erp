"use client";
import * as XLSX from "xlsx";
import type { DraftLine } from "./PoLinesEditor";

// Header keywords used to locate the relevant BOQ columns. Matching is
// case-insensitive and substring-based, so "Description of Work", "Item Description"
// and "Particulars" all resolve to the service column.
const DESC_KEYS = ["description", "particular", "item", "service", "scope", "work", "nomenclature"];
const UNIT_KEYS = ["unit", "uom", "u.o.m"];
const QTY_KEYS = ["qty", "quantity", "nos"];
const RATE_KEYS = ["rate", "unit price", "price", "amount/unit"];
const HSN_KEYS = ["hsn", "sac"];

function matchCol(headers: string[], keys: string[]): number {
  return headers.findIndex((h) => {
    const norm = h.toLowerCase().trim();
    return keys.some((k) => norm.includes(k));
  });
}

// Pulls the first finite number out of a cell, tolerating currency symbols,
// thousands separators and stray text (e.g. "Rs. 1,250.00" → 1250).
function cleanNum(v: unknown): string {
  if (v == null || v === "") return "";
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? String(n) : "";
}

// Reads an uploaded BOQ workbook (.xlsx/.xls) and extracts its priced line items.
// The header row is auto-detected (BOQs often carry title/logo rows above it), then
// every row beneath with a description and a quantity or rate becomes a draft line.
export async function parseBoqFile(file: File): Promise<DraftLine[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) throw new Error("The workbook has no sheets to read.");
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, blankrows: false });

  let headerIdx = -1, descCol = -1, unitCol = -1, qtyCol = -1, rateCol = -1, hsnCol = -1;
  for (let i = 0; i < rows.length; i++) {
    const cells = rows[i].map((c) => String(c ?? ""));
    const d = matchCol(cells, DESC_KEYS);
    const r = matchCol(cells, RATE_KEYS);
    const q = matchCol(cells, QTY_KEYS);
    // A real header row has a description column plus at least quantity or rate.
    if (d !== -1 && (r !== -1 || q !== -1)) {
      headerIdx = i;
      descCol = d;
      unitCol = matchCol(cells, UNIT_KEYS);
      qtyCol = q;
      rateCol = r;
      hsnCol = matchCol(cells, HSN_KEYS);
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error("Couldn't find BOQ columns — the sheet needs Description, Unit, Quantity and Rate headers.");
  }

  const lines: DraftLine[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const cells = rows[i];
    const service = String(cells[descCol] ?? "").trim();
    if (!service) continue;
    const unit = unitCol !== -1 ? String(cells[unitCol] ?? "").trim() : "";
    const quantity = qtyCol !== -1 ? cleanNum(cells[qtyCol]) : "";
    const rate = rateCol !== -1 ? cleanNum(cells[rateCol]) : "";
    const hsn = hsnCol !== -1 ? String(cells[hsnCol] ?? "").trim() : "";
    // Section/heading rows carry a description but no numbers — skip them.
    if (!quantity && !rate) continue;
    lines.push({ service, unit, quantity, rate, hsn });
  }
  if (lines.length === 0) {
    throw new Error("No priced line items were found beneath the BOQ headers.");
  }
  return lines;
}
