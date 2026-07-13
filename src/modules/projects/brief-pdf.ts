import "server-only";

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

/** Everything needed to render an approved brief as a document. */
export type BriefPdfData = {
  projectName: string;
  templateLabel: string;
  disciplineLabel: string;
  versionNo: number;
  approvedAt: string | null;
  columns: { key: string; label: string }[];
  sections: {
    title: string;
    questions: { id: string; text: string }[];
  }[];
  /** question_id -> { columnKey: value } */
  answers: Record<string, Record<string, string>>;
};

const A4 = { w: 595.28, h: 841.89 };
const MARGIN = 50;
const CONTENT_W = A4.w - MARGIN * 2;
const GREY = rgb(0.4, 0.4, 0.4);
const BLACK = rgb(0.1, 0.1, 0.1);

/** Split text into lines that fit `maxWidth` at the given font/size. */
function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines.length ? lines : [""];
}

/** Render an approved brief to a PDF byte array (A4, auto-wrapped + paginated). */
export async function renderBriefPdf(data: BriefPdfData): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  let page: PDFPage = doc.addPage([A4.w, A4.h]);
  let y = A4.h - MARGIN;

  const space = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([A4.w, A4.h]);
      y = A4.h - MARGIN;
    }
  };

  const writeBlock = (
    text: string,
    opts: { font: PDFFont; size: number; color?: typeof BLACK; gap?: number; indent?: number }
  ) => {
    const indent = opts.indent ?? 0;
    const lines = wrap(text, opts.font, opts.size, CONTENT_W - indent);
    const lineHeight = opts.size * 1.35;
    for (const line of lines) {
      space(lineHeight);
      page.drawText(line, {
        x: MARGIN + indent,
        y: y - opts.size,
        size: opts.size,
        font: opts.font,
        color: opts.color ?? BLACK,
      });
      y -= lineHeight;
    }
    y -= opts.gap ?? 0;
  };

  // Header ---------------------------------------------------------------------
  writeBlock(`Project Brief — ${data.templateLabel}`, { font: bold, size: 18, gap: 4 });
  const meta = [
    data.projectName,
    data.disciplineLabel,
    `Version ${data.versionNo}`,
    data.approvedAt ? `Approved ${new Date(data.approvedAt).toLocaleDateString()}` : "Approved",
  ]
    .filter(Boolean)
    .join("  ·  ");
  writeBlock(meta, { font, size: 10, color: GREY, gap: 12 });

  // Body -----------------------------------------------------------------------
  for (const section of data.sections) {
    space(28);
    writeBlock(section.title, { font: bold, size: 13, gap: 4 });

    for (const q of section.questions) {
      writeBlock(q.text, { font: bold, size: 10.5, gap: 1 });
      const values = data.answers[q.id] ?? {};
      const filled = data.columns.filter((c) => (values[c.key] ?? "").trim() !== "");
      if (filled.length === 0) {
        writeBlock("—", { font, size: 10, color: GREY, gap: 4, indent: 12 });
      } else {
        for (const col of filled) {
          writeBlock(`${col.label}: ${values[col.key]}`, {
            font,
            size: 10,
            color: GREY,
            indent: 12,
          });
        }
        y -= 4;
      }
    }
    y -= 6;
  }

  return doc.save();
}
