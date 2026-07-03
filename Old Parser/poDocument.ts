"use client";
import { jsPDF } from "jspdf";
import autoTable, { type CellDef, type RowInput } from "jspdf-autotable";
import { PDFDocument } from "pdf-lib";
import type { PricedLine } from "./PoLinesEditor";
import { STUDIO_MASONS, page1Notes, annexure, DEFAULT_PAYMENT_TERMS, DEFAULT_NOTES } from "./poTerms";

// ── Formatting helpers ───────────────────────────────────────
const money = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getDate()}.${d.getMonth() + 1}.${d.getFullYear()}`;
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function below1000(n: number): string {
  let s = "";
  if (n > 99) { s += ONES[Math.floor(n / 100)] + " Hundred"; n %= 100; if (n) s += " "; }
  if (n > 19) { s += TENS[Math.floor(n / 10)]; n %= 10; if (n) s += " "; }
  if (n > 0 && n < 20) s += ONES[n];
  return s;
}

function rupeesInWords(value: number): string {
  let n = Math.round(value);
  if (n === 0) return "Rupees Zero Only.";
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const parts: string[] = [];
  if (crore) parts.push(below1000(crore) + " Crore");
  if (lakh) parts.push(below1000(lakh) + " Lakh");
  if (thousand) parts.push(below1000(thousand) + " Thousand");
  if (n) parts.push(below1000(n));
  return `Rupees ${parts.join(" ").trim()} Only.`;
}

interface LoadedImage { data: string; w: number; h: number; isPng: boolean }

// Resolves a data URL to its natural dimensions (needed to keep aspect ratio).
function decodeImage(data: string): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ data, w: img.naturalWidth, h: img.naturalHeight, isPng: /^data:image\/png/i.test(data) });
    img.onerror = reject;
    img.src = data;
  });
}

// Fetches an image asset and decodes it; returns null if it can't be loaded.
async function loadImageUrl(url: string): Promise<LoadedImage | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const data = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result as string);
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    return await decodeImage(data);
  } catch {
    return null;
  }
}

export interface PoDocData {
  poNumber: string;
  date: string;            // ISO yyyy-mm-dd
  projectName: string;
  projectCode?: string;
  clientName?: string;
  location?: string;
  vendorName: string;
  vendorAddress?: string;
  vendorGstin?: string;
  subject?: string;
  quotationRef?: string;
  quotationDate?: string;  // ISO yyyy-mm-dd
  billingLines?: string[]; // issuer billing block (selected GST branch); defaults to head office
  notes?: Record<string, string>;        // editable page-1 note texts (keys "1".."11")
  paymentTermsLines?: string[];          // typed page-1 payment terms (note 5 a/b/c…)
  lines: PricedLine[];
  poValue: number;
  commencement?: string;                 // ISO; annexure row 1
  completion?: string;                   // ISO; annexure row 2
  annexRemarks?: Record<string, string>; // user-entered remarks for variable rows
  sealDataUrl?: string;                  // seal + signature image (data URL)
  annexureFile?: File;                   // extra annexure (PDF/image) to append
}

const DARK: [number, number, number] = [40, 40, 40];
const GREY: [number, number, number] = [110, 110, 110];
const BORDER: [number, number, number] = [70, 70, 70];

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "PO";
}

// Triggers a browser download for raw PDF bytes.
function downloadBytes(bytes: ArrayBuffer | Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Builds the Studio Masons purchase-order PDF (page 1 + annexure), optionally appends
// an uploaded annexure document, and downloads it. The file name carries the PO number
// and vendor name.
export async function generatePoPdf(d: PoDocData) {
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const M = 36;
  const innerW = pageW - M * 2;

  const [logo, seal] = await Promise.all([
    loadImageUrl("/logo-full.jpg"),
    d.sealDataUrl ? decodeImage(d.sealDataUrl).catch(() => null) : loadImageUrl("/seal-sign.png"),
  ]);

  // ── Masthead: logo ───────────────────────────────────────
  let y = M;
  if (logo) {
    const w = 120;
    const h = (logo.h / logo.w) * w;
    doc.addImage(logo.data, "JPEG", M, y, w, h);
    y += h + 10;
  } else {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(...DARK);
    doc.text("STUDIO MASONS", M, y + 20);
    y += 36;
  }

  const boxTop = y;
  const pad = 8;
  let ty = boxTop + pad + 9;
  doc.setFontSize(8.5);
  doc.setTextColor(...DARK);
  const metaLine = (label: string, value: string) => {
    doc.setFont("helvetica", "bold");
    doc.text(label, M + pad, ty);
    const labelW = doc.getTextWidth(label);
    doc.setFont("helvetica", "normal");
    doc.text(value, M + pad + labelW + 3, ty);
    ty += 13;
  };
  metaLine("Date: ", fmtDate(d.date));
  metaLine("PO Number: ", d.poNumber);

  // ── To / Billing two-column block ────────────────────────
  ty += 6;
  const colL = M + pad;
  const colR = M + innerW / 2 + pad;
  const blockTop = ty;
  doc.setFontSize(8.5);

  const renderParty = (x: number, heading: string, name: string, lines: string[], gstin?: string) => {
    let yy = blockTop;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.text(heading, x, yy); yy += 12;
    doc.text(name, x, yy); yy += 12;
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...GREY);
    for (const ln of lines) {
      const wrapped = doc.splitTextToSize(ln, innerW / 2 - pad - 6);
      doc.text(wrapped, x, yy);
      yy += 11 * wrapped.length;
    }
    if (gstin) { doc.setFont("helvetica", "bold"); doc.setTextColor(...DARK); doc.text(`GSTIN: ${gstin}`, x, yy); yy += 12; }
    return yy;
  };

  const vendorLines = (d.vendorAddress || "").split(/\r?\n|,/).map((s) => s.trim()).filter(Boolean);
  const yL = renderParty(colL, "To:", d.vendorName, vendorLines, d.vendorGstin);
  const yR = renderParty(colR, "Billing address:", STUDIO_MASONS.name, d.billingLines ?? STUDIO_MASONS.billingLines);
  ty = Math.max(yL, yR) + 6;

  // ── Subject / reference ──────────────────────────────────
  if (d.subject) {
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...DARK);
    doc.setFontSize(9);
    doc.text(`Sub: ${d.subject}`, pageW / 2, ty, { align: "center" });
    ty += 13;
  }
  if (d.quotationRef || d.quotationDate) {
    const ref = d.quotationRef ? `Ref : ${d.quotationRef}` : "Ref : Quotation";
    const dat = d.quotationDate ? ` Dated : ${fmtDate(d.quotationDate)}` : "";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(`${ref}${dat}`, pageW / 2, ty, { align: "center" });
    ty += 10;
  }

  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.7);
  doc.rect(M, boxTop, innerW, ty - boxTop + 2);
  ty += 12;

  // ── Line-item table ──────────────────────────────────────
  // Column widths are fixed so the notes below can wrap to the right edge of the Unit
  // column, leaving the right strip for the seal & signature (mirrors the template).
  const COL = { sl: 32, hsn: 52, unit: 36, qty: 50, rate: 58, amount: 64 };
  const descW = innerW - (COL.sl + COL.hsn + COL.unit + COL.qty + COL.rate + COL.amount);
  const unitRightX = M + COL.sl + descW + COL.hsn + COL.unit; // right border of Unit column

  autoTable(doc, {
    startY: ty,
    margin: { left: M, right: M },
    head: [["Sl No.", "Description", "HSN / SAC Code", "Unit", "Quantity", "Rate", "Amount"]],
    body: d.lines.map((l, i) => [
      String(i + 1),
      l.service,
      l.hsn || "",
      l.unit && l.unit !== "—" ? l.unit : "",
      l.quantity ? l.quantity.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "",
      l.rate ? money(l.rate) : "",
      money(l.amount),
    ]),
    foot: [[
      { content: "Grand Total", colSpan: 6, styles: { halign: "right" as const } },
      { content: money(d.poValue) },
    ]],
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4, textColor: DARK, lineColor: [200, 200, 200], lineWidth: 0.4, valign: "middle" },
    headStyles: { fillColor: [238, 238, 238], textColor: DARK, fontStyle: "bold", fontSize: 8, halign: "center" },
    footStyles: { fillColor: [248, 248, 248], textColor: DARK, fontStyle: "bold", fontSize: 9 },
    columnStyles: {
      0: { cellWidth: COL.sl, halign: "center" },
      1: { cellWidth: descW },
      2: { cellWidth: COL.hsn, halign: "center" },
      3: { cellWidth: COL.unit, halign: "center" },
      4: { cellWidth: COL.qty, halign: "right" },
      5: { cellWidth: COL.rate, halign: "right" },
      6: { cellWidth: COL.amount, halign: "right" },
    },
  });

  const tableBottom = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;

  // ── Notes (left of Unit border) + seal/signature (right) ──
  // If the table ends too low, move the notes/signature block to a fresh page so it
  // doesn't collide with the footer.
  let regionTop = tableBottom;
  if (regionTop > pageH - 230) { doc.addPage(); regionTop = M; }
  const rpad = 6;
  const leftWidth = unitRightX - M;               // notes wrap inside the Unit column
  const rightX0 = unitRightX;                     // signature strip starts at Unit border
  const rightWidth = pageW - M - rightX0;
  const rightCx = rightX0 + rightWidth / 2;

  // Left column: amount in words, then the numbered notes (payment terms typed in).
  let yLeft = regionTop + rpad + 9;
  const numX = M + 4;
  const textX = M + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...DARK);
  const wordsWrapped = doc.splitTextToSize(rupeesInWords(d.poValue), leftWidth - 8);
  doc.text(wordsWrapped, M + 4, yLeft);
  yLeft += wordsWrapped.length * 9 + 4;

  const notes = page1Notes({
    notes: d.notes ?? DEFAULT_NOTES,
    paymentTermsLines: d.paymentTermsLines && d.paymentTermsLines.length ? d.paymentTermsLines : DEFAULT_PAYMENT_TERMS,
  });
  doc.setFontSize(7.5);
  for (const note of notes) {
    doc.setFont("helvetica", note.bold ? "bold" : "normal");
    const indent = note.indent ? 12 : 0;
    const wrapped = doc.splitTextToSize(note.text, leftWidth - (textX - M) - indent - 4);
    doc.setTextColor(...DARK);
    doc.text(note.n, numX + indent, yLeft);
    doc.text(wrapped, textX + indent, yLeft);
    yLeft += wrapped.length * 8.6 + 1.6;
  }

  // Right column: "For Studio Masons…", then "Authorized Signatory", then the
  // seal/signature below it (the sign also repeats bottom-right on every later page).
  let yRight = regionTop + rpad + 11;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...DARK);
  const forLines = doc.splitTextToSize("For Studio Masons Private Limited", rightWidth - 8);
  doc.text(forLines, rightCx, yRight, { align: "center" });
  yRight += forLines.length * 9 + 12;

  doc.setFontSize(8.5);
  doc.text("Authorized Signatory", rightCx, yRight, { align: "center" });
  yRight += 8;

  if (seal) {
    let w = Math.min(rightWidth - 12, 150);
    let h = (seal.h / seal.w) * w;
    const maxH = 90;
    if (h > maxH) { h = maxH; w = (seal.w / seal.h) * h; }
    doc.addImage(seal.data, seal.isPng ? "PNG" : "JPEG", rightCx - w / 2, yRight, w, h);
    yRight += h + 4;
  } else {
    yRight += 56; // leave room for a physical stamp/signature
  }

  // Region border + the Unit-column divider continuing beneath the table.
  const regionBottom = Math.max(yLeft, yRight) + rpad;
  doc.setDrawColor(...BORDER);
  doc.setLineWidth(0.7);
  doc.rect(M, regionTop, innerW, regionBottom - regionTop);
  doc.line(unitRightX, regionTop, unitRightX, regionBottom);

  drawFooter(doc, M, pageW, pageH);

  // ── Annexure pages ───────────────────────────────────────
  const sections = annexure({ commencement: fmtDate(d.commencement), completion: fmtDate(d.completion), remarks: d.annexRemarks });
  const annexBody: RowInput[] = [];
  annexBody.push([{ content: "ANNEXURE-I — ADDITIONAL TERMS & CONDITIONS", colSpan: 4, styles: { halign: "center", fontStyle: "bold", fillColor: [225, 225, 225], textColor: DARK } } as CellDef]);
  for (const sec of sections) {
    annexBody.push([{ content: sec.heading, colSpan: 4, styles: { halign: "center", fontStyle: "bold", fillColor: [240, 240, 240], textColor: DARK } } as CellDef]);
    for (const r of sec.rows) annexBody.push([r.sl, r.title, r.description, r.remarks]);
  }

  doc.addPage();
  autoTable(doc, {
    startY: M,
    margin: { left: M, right: M, bottom: 40 },
    head: [["Sl No", "Term", "Description", "Remarks"]],
    body: annexBody,
    theme: "grid",
    styles: { fontSize: 7.5, cellPadding: 4, textColor: DARK, lineColor: [200, 200, 200], lineWidth: 0.4, valign: "top" },
    headStyles: { fillColor: [40, 40, 40], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 32, halign: "center" },
      1: { cellWidth: 110, fontStyle: "bold" },
      3: { cellWidth: 80, halign: "center" },
    },
  });

  const filename = `${slug(d.poNumber)}_${slug(d.vendorName)}.pdf`;
  await finalize(doc, filename, seal, d.annexureFile);
}

// Decodes a data URL's base64 payload to raw bytes (for pdf-lib embedding).
function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] ?? "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Assembles the final document: PO pages + the optional uploaded annexure, then
// stamps the seal/signature at the bottom-right of every page after the first
// (page 1 already carries it below "Authorized Signatory").
async function finalize(doc: jsPDF, filename: string, seal: LoadedImage | null, annexureFile?: File) {
  const poBytes = doc.output("arraybuffer");
  const out = await PDFDocument.create();
  const po = await PDFDocument.load(poBytes);
  (await out.copyPages(po, po.getPageIndices())).forEach((p) => out.addPage(p));

  if (annexureFile) {
    const ab = await annexureFile.arrayBuffer();
    const name = annexureFile.name.toLowerCase();
    const type = annexureFile.type;
    if (type === "application/pdf" || name.endsWith(".pdf")) {
      const an = await PDFDocument.load(ab);
      (await out.copyPages(an, an.getPageIndices())).forEach((p) => out.addPage(p));
    } else if (type.startsWith("image/") || /\.(png|jpe?g)$/i.test(name)) {
      const img = type.includes("png") || name.endsWith(".png") ? await out.embedPng(ab) : await out.embedJpg(ab);
      const page = out.addPage([img.width, img.height]);
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    } else {
      throw new Error("Unsupported annexure file — upload a PDF or image.");
    }
  }

  if (seal) {
    const img = seal.isPng ? await out.embedPng(dataUrlToBytes(seal.data)) : await out.embedJpg(dataUrlToBytes(seal.data));
    const w = 84;
    const h = (seal.h / seal.w) * w;
    const pages = out.getPages();
    for (let i = 1; i < pages.length; i++) {
      const { width } = pages[i].getSize();
      pages[i].drawImage(img, { x: width - 36 - w, y: 26, width: w, height: h });
    }
  }

  downloadBytes(await out.save(), filename);
}

function drawFooter(doc: jsPDF, M: number, pageW: number, pageH: number) {
  let fy = pageH - 52;
  doc.setDrawColor(...GREY);
  doc.setLineWidth(0.5);
  doc.line(M, fy, pageW - M, fy);
  fy += 11;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.setTextColor(...DARK);
  doc.text(STUDIO_MASONS.name, M, fy);
  fy += 9;
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...GREY);
  doc.setFontSize(6.8);
  for (const ln of STUDIO_MASONS.footerLines) {
    doc.text(ln, M, fy);
    fy += 8;
  }
}
