# Comparison BOQ — Standard Format for Import

This is the format the Procurement module's Comparison BOQ importer expects. It is
designed to (a) parse cleanly per-line **per-vendor**, (b) bind each line back to a
**Budget BOQ line** so the quantity threshold and line-level award work, and (c)
stay consistent with the [Budget BOQ format](./budget-boq-format.docx) so the
QS/Procurement team learns one set of rules.

Like the Budget BOQ import, the Comparison BOQ import has a **review step**: every
sheet is listed with its detected fixed columns, detected vendor blocks, line
count, unmatched-vendor warnings, and a per-vendor total reconciliation before
anything is saved. A compliant workbook reviews clean.

The two parsers are deliberately symmetric:

- **Budget BOQ:** `BOQ Ref · Description · Unit · Qty · Rate · Amount`
- **Comparison BOQ:** the same left side **+ a repeating `[Rate · Amount]` block
  per vendor**, joined back to the budget line by `BOQ Ref`.

That symmetry keeps it simple and modular — one shared sheet-walking / header-
detection core, two thin column mappers.

---

## 1. Workbook = packages

- **One worksheet per package.** The sheet name = the package name, and **must
  match the Budget BOQ package** it draws from so lines reconcile.
- **Don't hide sheets you want imported.** Hidden / very-hidden worksheets are
  skipped automatically (they appear in the review, pre-unticked).
- **Reserved names are skipped.** A sheet whose name contains `summary`,
  `comparison summary`, `cost summary`, `m sheet`, or `measurement` is treated as a
  non-line-item sheet and skipped.
- A sheet with no recognizable header row, or no priced vendor rows, is skipped.

## 2. Fixed (left-hand) columns — describe the line

Each package sheet needs one header row (it may be a two-row header — see §3). The
parser finds it automatically (it may sit below title/logo rows). A row qualifies
as the header when it has a **Description** column plus a **Qty** column. Matching
is case-insensitive and substring-based.

| Column | Accepted header text | Required | Notes |
|---|---|---|---|
| **Description** | `Description`, `Description of Work`, `Particulars`, `Nomenclature`, `Scope` | **Yes** | Identifies the line. Must match the corresponding Budget BOQ line — this is how the comparison line **binds to a budget line** (enabling the quantity check and line-level award). Binding is by Description within the package; unmatched lines are flagged in the review. |
| **Unit** | `Unit`, `UOM`, `U.O.M` | Recommended | |
| **Qty** | `Qty`, `Quantity`, `Total Qty`, `Qty as per BOQ` | **Yes** | The quantity being compared. For a whole-package comparison this equals the Budget BOQ line quantity; for an intent-scoped comparison it is the intent quantity. Either way it is checked against the BOQ line's **remaining** budgeted quantity. |
| **BOQ Ref** *(optional)* | `BOQ Ref`, `Ref`, `BOQ Code`, `Item Code` | No | If present, binds the line to its Budget BOQ line **exactly** (bypassing description matching). Recommended when descriptions are long/edited. The ERP can emit a pre-filled comparison template with this column already populated (see §8). |

> **Spec paragraphs are skipped.** As in the Budget BOQ, a row with a description
> but no numbers (the long specification paragraph beneath an item) is ignored as a
> line item — keep it for readability. A row whose description is only a number
> (stray serial) is skipped.

## 3. The BUDGET block + vendor blocks (this is the comparison)

To the **right** of the fixed columns comes a repeating pattern of `[Rate · Amount]`
blocks. The **first** block is the reference **BUDGET**; every block after it is a
**vendor**. Two accepted layouts (mirroring the Budget BOQ supply/installation
split rule):

**A — two-row header (preferred, matches the real sheets):** the block name on row 1
(`BUDGET`, then each vendor name) spanning its sub-columns; `Rate` / `Amount` (and
optional `Make`) directly beneath on row 2.

```
Row 1:  | Description | Unit | Qty | BUDGET |        | Huma Interior |        | Nice Interiors |        |
Row 2:  |             |      |     | Rate   | Amount | Rate  | Amount | Rate   | Amount |
```

**B — inline:** `Budget Rate`, `Budget Amount`, `Huma Interior Rate`, `Huma Interior Amount`, …

The **BUDGET** block:
- Recognized by the header `Budget` (case-insensitive). It is the budgeted
  rate/amount for the line, shown for the Director's comparison.
- The importer **reconciles the sheet's budget figures against the stored Budget
  BOQ** for that package/line and flags any mismatch in the review. The stored
  Budget BOQ remains the source of truth — the sheet's budget block is validated,
  not trusted blindly. If omitted, the ERP shows its own stored budget anyway.

Rules for **vendor** blocks:

- **Rate** (per unit) is required per vendor per line. **Amount** is optional — if
  absent the parser computes `Rate × Qty`; if present it is reconciled against
  `Rate × Qty` and flagged on mismatch (>0.5%).
- **Make/Brand** (optional sub-column) — captures that vendors may quote different
  brands for the same line.
- A vendor that **didn't quote** a line → leave its Rate **blank** (reads as "no
  quote", not 0). That line cannot be awarded to that vendor.
- **The vendor name in the header must match a vendor in the directory.** Unmatched
  names are surfaced in the import review, where you map them to a directory vendor
  or skip them. Only directory vendors that are **globally approved** *and*
  **approved for this project** can ultimately be awarded.

## 4. Optional columns (kept, not required)

- **Recommended** (`Recommended`, `Reco`) — the Procurement Manager's suggested
  vendor per line (free text = vendor name, or an `x` in a per-vendor reco column).
  Advisory only; the **Project Director makes the binding choice in the ERP**, not
  in the sheet.
- **Remarks** per line.

## 5. Per-vendor total rows (reconciliation)

- Give each vendor block a labelled **`Grand Total`** row (value in that vendor's
  Amount column). The importer cross-checks each vendor's parsed line-sum against
  its stated total → ✓ / ⚠, exactly like the Budget BOQ.

## 6. Total / tax rows

- Give each block (Budget and every vendor) a labelled **`Grand Total`** row so the
  reconciliation shows ✓ (see §5).
- **Tax is excluded.** Lines are ex-GST; a `GST EXTRA AS ACTUAL` note (or `GST`,
  `IGST`, `CGST`, `SGST`, `Round Off` rows) is ignored by the parser, exactly as in
  the Budget BOQ. The awarded value the ERP records is ex-GST.

## 7. Numbers & formatting

- Currency symbols and thousands separators are tolerated (`Rs. 1,250.00 → 1250`).
- Rates/amounts are stored to 2 decimals; quantities to 2 decimals.
- A **blank vendor rate ≠ 0** — it means "no quote". (Elsewhere blank cells read as 0.)

## 8. Canonical template (clean, always imports)

Modelled on the real sample — a `BUDGET` reference block followed by one block per
vendor, lines bound by Description, spec paragraphs kept but skipped:

```
| Description         | Unit | Qty  | BUDGET |         | Huma Interior |         | Nice Interiors |         |
|                     |      |(BOQ) | Rate   | Amount  | Rate  | Amount  | Rate   | Amount  |
|---------------------|------|------|--------|---------|-------|---------|--------|---------|
| Gypsum False Ceiling| Sqm  | 1033 | 800    | 826400  | 882.65| 911775  | 1022.58| 1056325 |
|   <spec paragraph — kept for readability, skipped as a line>                                |
| 100mm Thick Partition| Sqm | 446  | 2300   | 1025800 | 2378.84| 1060964| 2906.28| 1296200 |
|   <spec paragraph>                                                                          |
|                     |      |      |        |         |        |        |        |         |
| Grand Total         |      |      |        | 2039604 |        | 2172110|        | 2572778 |
```

A vendor that didn't quote a line leaves its Rate **blank** (not 0) — that line then
can't be awarded to them. The Director can award the **whole package** to one vendor
(by grand total) or **split line-by-line** (e.g. the cheapest compliant vendor per
line).

The ERP can also **emit a pre-filled template** for a package — Description, Unit,
Qty and the Budget block already populated from the stored Budget BOQ, plus empty
vendor blocks to fill in. Using it removes description-matching warnings entirely.

## 9. Quick checklist

- ☐ One sheet per package; sheet name = the Budget BOQ package name.
- ☐ No sheet you want imported is hidden.
- ☐ No package sheet named with `summary` / `comparison summary` / `m sheet` / `measurement`.
- ☐ A clear `Description` header and a `Qty` header; descriptions match the Budget BOQ.
- ☐ A `BUDGET` block, then one `[Rate · Amount]` block per vendor (vendor name as the block header).
- ☐ Vendor names match directory vendors (confirm any warnings in the review).
- ☐ Blank rate where a vendor didn't quote (not 0).
- ☐ A labelled `Grand Total` per block so the reconciliation shows ✓.
- ☐ Open the review step on import and confirm each package, the budget, and each vendor reads ✓.
