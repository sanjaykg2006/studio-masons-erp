import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";

import { parseBudgetWorkbook } from "@/modules/procurement/import/parse";

/** Build an .xlsx in memory from {sheetName: rows} and hand it to the parser. */
async function parse(sheets: Record<string, (string | number)[][]>) {
  const wb = new ExcelJS.Workbook();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = wb.addWorksheet(name);
    rows.forEach((r) => ws.addRow(r));
  }
  const buf = await wb.xlsx.writeBuffer();
  return parseBudgetWorkbook(buf as ArrayBuffer);
}

describe("parseBudgetWorkbook", () => {
  it("reads a split Supply/Installation sheet — clubbing both into the rate (installation is not dropped)", async () => {
    const { packages } = await parse({
      Electrical: [
        ["S.L", "Description", "Unit", "Qty", "Supply Rate", "Installation Rate", "Total Amount"],
        ["1", "Cable tray", "Rmt", 10, 100, 50, 1500],
        ["", "Grand Total", "", "", "", "", 1500],
      ],
    });
    expect(packages).toHaveLength(1);
    const pkg = packages[0];
    expect(pkg.lines).toHaveLength(1);
    // rate = amount / qty = 1500 / 10 = 150 (i.e. 100 supply + 50 install), NOT 100.
    expect(pkg.lines[0].qty).toBe(10);
    expect(pkg.lines[0].rate).toBeCloseTo(150, 5);
    expect(pkg.total).toBeCloseTo(1500, 5);
    expect(pkg.reconcile).toEqual({ status: "ok", sheetTotal: 1500 });
  });

  it("treats a bare 'TOTAL' column as the quantity (interior/furniture layout)", async () => {
    const { packages } = await parse({
      Modular: [
        ["Sl.No", "Description", "Unit", "TOTAL", "Rate", "Amount"],
        ["1", "Workstation", "Nos", 5, 1000, 5000],
        ["", "Total", "", "", "", 5000],
      ],
    });
    expect(packages).toHaveLength(1);
    expect(packages[0].lines[0].qty).toBe(5);
    expect(packages[0].lines[0].rate).toBeCloseTo(1000, 5);
    expect(packages[0].total).toBeCloseTo(5000, 5);
    expect(packages[0].reconcile.status).toBe("ok");
  });

  it("flags a sheet whose lines don't add up to its stated total", async () => {
    const { packages } = await parse({
      Civil: [
        ["Sl.No", "Description", "Unit", "Qty", "Rate", "Amount"],
        ["1", "Screed", "Sqm", 10, 100, 1000],
        ["", "Grand Total", "", "", "", 9999], // deliberately wrong
      ],
    });
    expect(packages[0].reconcile).toEqual({ status: "warn", sheetTotal: 9999 });
  });

  it("reports 'none' when a sheet has no total row to check against", async () => {
    const { packages } = await parse({
      Misc: [
        ["Sl.No", "Description", "Unit", "Qty", "Rate", "Amount"],
        ["1", "Widget", "Nos", 2, 250, 500],
      ],
    });
    expect(packages[0].reconcile.status).toBe("none");
  });

  it("skips section headings and GST rows, keeping only priced lines", async () => {
    const { packages } = await parse({
      Sanitary: [
        ["Item No", "Description", "Unit", "Qty", "Rate", "Amount"],
        ["A", "INTERNAL FIXTURES", "", "", "", ""], // section heading (no numbers)
        ["1", "WC unit", "Nos", 4, 5000, 20000],
        ["", "GST 18%", "", "", "", 3600], // tax row — excluded from lines & recon
        ["", "Grand Total", "", "", "", 20000],
      ],
    });
    expect(packages[0].lines).toHaveLength(1);
    expect(packages[0].lines[0].description).toBe("WC unit");
    expect(packages[0].reconcile).toEqual({ status: "ok", sheetTotal: 20000 });
  });
});
