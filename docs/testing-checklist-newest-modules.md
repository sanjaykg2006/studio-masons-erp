# Testing checklist — Inventory, Finance & Petty Cash (as of 2026-07-13)

A plain-English, click-by-click guide for the three newest modules, in the same
style as [`testing-checklist.md`](testing-checklist.md) (which covers RFI +
Procurement). Work top to bottom. Each item says **what it is**, **how to switch
it on**, and **what to click** to prove it works.

> **Legend:** ⬜ = to test · ✅ = passed · ❌ = found a problem (note what happened)

---

## 0. Before you start

- **Migrations:** all database updates (0001–0063) are **already applied** to the
  live database — you do **not** need to run `npm run db:push`. To confirm: run
  `npx supabase migration list` and check the Local and Remote columns both reach
  `0063`.
- **Easiest way to test everything:** sign in with an **admin** account (it can do
  every step). To test that the *right* people are gated correctly, also make a
  second, non-admin account and grant it specific roles via **Access** or a
  department's **People & Access**.
- **Pre-req for Finance:** Finance sits on top of Procurement. You'll need a project
  that already has an **Issued purchase order** with the **vendor's acceptance
  letter uploaded** (from the Procurement checklist, sections 5–9). Without that,
  invoices can't be entered — that's by design.

---

# Part A — Inventory

The full end-user guide is [`inventory-management-guide.md`](inventory-management-guide.md).
This is the tester's version.

## A1. Project material — the received / consumed / on-hand tracker

**What it is:** inside each project, a table of materials showing **Ordered**,
**Received** (automatic, from goods receipts), **Consumed** (recorded by hand), and
**On hand** (Received − Consumed).

**Switch it on:** needs `inventory.material` on the project. Admin sees it
automatically; otherwise grant the Inventory verbs via the project team or a role.

**Where:** open a project → **Inventory** → **Project material** tab (or
`/projects/<id>/inventory`).

- ⬜ **Pre-req:** the project has at least one **goods receipt** recorded against a PO
  (Procurement checklist §9). A material row should appear on its own — you never add
  rows by hand.
- ⬜ Read a row: **Received** matches what you received; **On hand** = Received −
  Consumed.
- ⬜ Click **Record consumption** → pick a material (the dropdown shows how much is on
  hand) → enter a quantity **within** on-hand → optional date + note → **Save**. On
  hand drops by that amount.
- ⬜ Try to consume **more than is on hand** → it's refused with a clear message; on
  hand never goes below zero.
- ⬜ Click **Show consumption history** → your entry is listed with date, quantity,
  note and **who recorded it**.
- ⬜ As a manager, **remove** a wrong history entry → the numbers correct themselves.
- ⬜ A user **without** `inventory.material` on the project: no Inventory card, and
  `/projects/<id>/inventory` bounces to Forbidden.

## A2. Company assets — the equipment register

**What it is:** a company-wide register of reusable equipment (machines, laptops…),
each with a **category**, **current project**, **custodian** (a real person), and
**status** (In use / Idle / Retired).

**Switch it on:** needs `inventory.asset`. `read` to view, `update` for
transfer/place, `delete` + senior actions for direct-place/unassign/remove.

**Where:** main sidebar → **Inventory** (all assets), or a project's **Inventory** →
**Company assets** tab.

- ⬜ **Add asset** → name (only required field) + optional category/tag/notes →
  **Save**. It appears, and the category strip at the top updates its count.
- ⬜ **Transfer (⇄)** an asset → pick project + new custodian + note → **Send
  transfer**. The asset **does not move yet** — it shows *"transfer pending."*
- ⬜ Sign in as the **new custodian** → a **"Transfers awaiting your acceptance"** box
  appears at the top → **Accept** → the asset now sits with them. (Also try
  **Decline**, and **Cancel** as the sender while pending.)
- ⬜ **Direct place (person+)** as a **senior** account → pick project + custodian →
  confirm → it's assigned **immediately, no acceptance step**. As a non-senior, this
  button should not appear.
- ⬜ **Retire** an asset (confirm) → it can't be placed/transferred while retired →
  **Reactivate** brings it back.
- ⬜ **Unassign** (senior, confirm) → asset goes **Idle**. **Remove** (confirm)
  deletes the record.

---

# Part B — Finance (the money desk)

Reached per-project from a project's **Finance** card, plus a company-wide hub at
**Departments → Finance**. Four tabs on the project page: **Vendor invoices**,
**Payment requests**, **Retention**, **POs & advances**.

**Who does what (the roles that matter):**

| Step | Role that can do it |
|---|---|
| Enter an invoice, raise a payment request, request a PO advance | **Project Manager** |
| Approve invoices & payments, approve advances, override PO cap, request early retention release | **Project Director** |
| Book invoices, mark payments/retention/advances paid | **Accounts Team** |
| Manage billing branches | **Finance Head / Billing** |
| Override PO cap & approve early retention release | **Project Director / MD** |

Grant these via **Access** (company-wide) or the **Finance** department's **People &
Access**. An admin can do every step alone for a quick run-through.

## B1. Billing branches (do this first)

**What it is:** your company's GST registrations, picked on each purchase order.

**Where:** **Departments → Finance → Billing branches** (or `/finance/settings`).

- ⬜ **Add a branch** → name + GSTIN + address → **Save**. It appears in the list.
- ⬜ **Edit** it; **Deactivate**/**Activate** it (deactivated branches stay on old POs
  but don't offer for new ones).
- ⬜ A user without `finance.settings` can't reach this page.

## B2. PO terms + advance (POs & advances tab)

**What it is:** on each PO, set the **fixed-contract window** and **billing branch**,
and run the **advance** lifecycle: request → Director approves → Accounts pays.

**Where:** project → **Finance** → **POs & advances** tab.

- ⬜ **Set terms** on a PO → optionally tick **fixed contract** (then start + end
  dates are required) → pick a **billing branch** → **Save**.
- ⬜ As **PM**, **Request advance** → amount + advance TDS % → **Save**.
- ⬜ As **Project Director**, **Approve** the advance → it shows the **payable** =
  amount − its own TDS.
- ⬜ As **Accounts**, **Mark advance paid** → it's recorded as paid (this is what the
  "advances unpaid" report counts down).
- ⬜ Only **one** advance per PO — a second request is refused.

## B3. Vendor invoices — enter → approve → book  ⭐ (verify the money math here)

**What it is:** the PM enters a vendor's bill against a PO; the Project Director
approves; Accounts books it (confirms GST, adds other charges, sets TDS, deducts
advance, holds retention) and lands on the **amount payable**.

**Where:** project → **Finance** → **Vendor invoices** tab.

- ⬜ As **PM**, **New invoice** → pick the PO → enter the **vendor's real invoice
  number + date** → add one or more **GST lines** (base + SGST/CGST/IGST %) →
  optional invoice file → **Save**. It appears as **Awaiting director**.
- ⬜ **Gates to spot-check** (each should block with a clear message):
  - a PO with **no acceptance letter** → invoice refused.
  - a PO that isn't **Issued/Closed** → refused.
  - the **same vendor + invoice number** twice → refused as a duplicate.
  - a **fixed-contract** PO with an invoice **date outside** the window → refused.
- ⬜ As **Project Director**, **Approve** → it moves to **Awaiting accounts**.
- ⬜ As **Accounts**, open the **book** modal → confirm the GST lines, add **other
  charges**, set **TDS %**, optionally **deduct advance**, optionally **hold 5%
  retention** → the **live preview** shows Subtotal / Less advance / Less TDS / Less
  retention / **Amount payable** → **Book**. Status becomes **Approved**.

  > **✅ Verify the corrected money math (fixed on 2026-07-13).** With a **₹1,00,000**
  > base + **18% GST**, **TDS 2%**, retention held, **no advance**, the preview and
  > the booked invoice must read:
  >
  > | Line | Expected |
  > |---|---|
  > | Subtotal | ₹1,18,000 |
  > | Less TDS (2% of the **₹1,00,000** base, GST excluded) | − ₹2,000 |
  > | Less retention (5% of the **₹1,00,000** base) | − ₹5,000 |
  > | **Amount payable** | **₹1,11,000** |
  >
  > If TDS shows ₹2,360 or retention ₹5,782, the old (wrong) formula is still in
  > effect — flag it. Also confirm amounts are clean to 2 decimals (paise).

- ⬜ **PO-cap block:** enter invoices whose **base values** together exceed the PO
  value → the invoice is flagged **Over cap** and the Director **cannot approve** it…
- ⬜ …until a **Director/MD** clicks the **override** → then approval goes through, and
  the override is recorded.
- ⬜ After an invoice is **Approved**, its **base value** should show as "invoices
  booked" against the project budget (Procurement budget-vs-expenditure headline).

## B4. Payment requests

**What it is:** raise a request to pay (part of) an approved invoice; Director
approves; Accounts marks it paid. Partial payments allowed; priority tag for triage.

**Where:** project → **Finance** → **Payment requests** tab.

- ⬜ As **PM**, on an **Approved** invoice **Raise payment request** → amount (≤ the
  remaining payable) + priority (Low/Medium/High) + note → **Save**.
- ⬜ Try an amount **more than remaining** → refused with the remaining figure.
- ⬜ As **Project Director**, **Approve** it; as **Accounts**, **Mark paid**.
- ⬜ Raise a **second partial** request for the rest → the remaining goes to zero.
- ⬜ **Reject** a request → the amount frees back up on the invoice.
- ⬜ The list is sorted with **High** priority first.

## B5. Retention

**What it is:** the 5% held at booking, due 12 months later. Accounts pays it on
maturity; early release needs a Director request + MD approval.

**Where:** project → **Finance** → **Retention** tab.

- ⬜ Each held retention shows its **amount** and **due date** (booking date + 12
  months) as **Held**.
- ⬜ **Mark paid** before the due date → refused (not yet due).
- ⬜ As **Director**, **Request early release** → as **MD**, **Approve early release**
  → now **Accounts** can **Mark paid** even before the due date.
- ⬜ For a matured one (due date passed), **Accounts** can **Mark paid** directly.

## B6. Reports (Finance dashboard)

**What it is:** headline totals + ageing + vendor statement + Tally export, across
**every** project you can see.

**Where:** **Departments → Finance → Reports** (or `/finance/reports`).

- ⬜ Four tiles read sensibly: **Owed to vendors** (approved − paid), **Paid this
  month**, **Advances unpaid**, **Retention held**.
- ⬜ The **ageing table** lists approved invoices with **Days due** counting from the
  accounts-approval date, and a **due date** column.
- ⬜ The **vendor outstanding** statement shows invoiced / paid / retention held /
  still owed per vendor.
- ⬜ **Export (Tally CSV)** downloads a file with the base/GST/TDS split — open it and
  confirm the columns line up.

---

# Part C — Petty Cash

**What it is:** a **company-wide** module any employee can open to log a small spend
and claim/settle it. Approval chain: **Billing → MD → Accounts (pays)**.

**Switch it on:** `pettycash.entry` **create** is held by every employee, so the
sidebar link shows for everyone. **Billing** approves (and manages categories), **MD**
approves, **Accounts** pays.

**Where:** main sidebar → **Petty Cash** (`/pettycash`).

- ⬜ **Categories first:** as **Billing**, click **Categories** → **Add** a couple
  (Travel, Food…) → **Deactivate**/**Activate** one. Non-Billing users don't see the
  Categories button.
- ⬜ **Log spend** → amount → category → **Type** (Reimbursement **or** Cash float) →
  **Project** (or leave **Company (no project)**) → date → optional description +
  voucher file → **Submit**. It appears as **Pending billing**.
- ⬜ Try amount **0 or blank** → refused ("Enter an amount").
- ⬜ Walk the chain: as **Billing** click **Billing** ✓ → status **Pending MD**; as
  **MD** click **MD** ✓ → **Pending accounts**; as **Accounts** click **Pay** →
  **Paid**. (Colours change at each step.)
- ⬜ **Reject** at any pending step (with a reason) → status **Rejected**, reason shown.
- ⬜ As the person who logged it, while still **Pending billing**, **Remove** your own
  entry (trash icon).
- ⬜ Open an uploaded **voucher** (file icon) → it opens via a secure link.
- ⬜ **Export mine** → downloads a CSV of only **your** entries.
- ⬜ **Visibility:** a random employee sees only **their own** entries; **Billing** and
  **Accounts** see everyone's.

---

## What to do with results

Tick ✅ as you go; for any ❌ note **what you clicked**, **what you expected**, and
**what happened** (plus the reference code if a crash screen appeared). Send that back
and it becomes the fix list. The ⭐ money-math check in **B3** is the most important
one — do that early.
