# Finance + Petty Cash — Build Plan

_Written 2026-07-07. Requirements captured in `finance-module-questions.md` (Rounds
1–3). This is the build brief: what we're creating, how it's structured, and the
order of work. Plain-English first, technical detail after each part._

---

## 1. What we're building, in one paragraph

Two new things that sit **on top of** the existing Procurement module:

1. **Finance** — a new department module (reached through the Departments hub, like
   Procurement/Inventory). It's the "money desk": vendor invoices against a PO,
   payment requests, advances, retention, billing branches, and a reports page. All
   **project-scoped** but with **all-projects visibility** for the finance team.
2. **Petty Cash** — a separate, **company-wide** module on the main sidebar that
   **any employee** can open to log a small spend and claim/settle it.

Everything is rebuilt the current way: one migration per area, reads via database
row-level security (RLS), all writes via permission-checked database functions
(SECURITY DEFINER RPCs) — the exact shape of `0054_inventory.sql`. **No old code is
reused**; only the business rules carry over.

---

## 2. New roles & departments (the access model)

**New department: `finance`**, with these roles:
- **Finance Head** — department lead (full finance visibility + settings).
- **Accounts Head** — senior accounts.
- **Accounts team** — books invoice approvals, marks payments/retention paid.
- **Billing team** — sits in the petty-cash chain; manages petty-cash categories +
  billing branches.

**New company-wide senior role: `md` (Managing Director)** — top authority. Approves
PO-cap overrides and early retention release; approves petty cash.

**Reused (already exist, company-wide project-management roles):**
- **Project Manager** — enters vendor invoices, raises payment requests.
- **Project Director** — approves invoices and payment requests, approves advances,
  overrides the PO cap.

> Per your O2 answer: Project-Management roles apply across every project regardless
> of which department owns it, so PM/PD are reused as-is — no Finance-specific copies.

---

## 3. Permission resources (what the access matrix will show)

| Resource | Scope | Verbs → who | Notes |
|---|---|---|---|
| `finance.invoice` | project | create → PM · approve → PD · review → Accounts (books it) · manage → PD/MD (PO-cap override) · read · delete | The vendor bill + its approval chain |
| `finance.payment` | project | create → PM (raise request) · approve → PD · issue → Accounts (mark paid) · read | Partial payments allowed |
| `finance.retention` | project | issue → Accounts (mark paid) · manage → early release (Accounts, after Director request + MD approval) · read | The retention register |
| `finance.advance` | project | approve → PD (approve on PO) · issue → Accounts (mark paid/track) · read | Lives on the PO; see §5 |
| `finance.settings` | department | manage → Finance Head/Billing | Billing branches (name + GSTIN) |
| `pettycash.entry` | **company-wide** | create → **any employee** · approve → Billing · manage → MD · issue → Accounts (pay) · read | See §7 |
| `pettycash.category` | department | manage → Billing | The editable category list |

Verbs come from the existing 8-verb set (`create/read/update/delete/review/approve/
issue/manage`) — no new verbs needed. `approve` vs `review` vs `issue` let us give
the PD, Accounts, and "mark-paid" steps distinct checkboxes, exactly like
`procurement.order` already does.

---

## 4. Vendor invoice — the full lifecycle

**Who does what:** PM enters → **Project Director approves** → **Accounts books it**
→ (later) payment requests.

1. **PM enters the invoice** against a vendor's PO. Hard gates before it's accepted:
   - a PO exists for that vendor on that project;
   - the vendor's **acceptance letter** is on file against the PO;
   - if the PO is a **fixed contract**, the invoice date is inside the contract window;
   - cumulative **base value** (pre-GST) stays within the **PO value** — unless a
     PD/MD override is applied (`finance.invoice: manage`), which **notifies Accounts**.
   Captured: the **vendor's real invoice number + date** (blocks duplicates —
   same vendor + number warns), up to **4 GST base lines** (each with SGST/CGST/IGST),
   a **payment due date**, and the uploaded invoice file. → status **Pending Director
   Approval**.
2. **Project Director approves** (or rejects). → **Pending Accounts Approval**.
3. **Accounts approves** with the money math: confirm/adjust the GST lines, add flat
   **other charges** (inside the TDS base), enter **TDS %** (typed fresh), optionally
   **deduct advance**, optionally **hold 5% retention**. Lands on **amount payable**.
   On approval:
   - the invoice's **base value is booked against the project budget** (feeds the
     "budget vs invoices booked" number) — regardless of whether it's paid;
   - the **ageing clock starts** (days-due counts up from approval until fully paid);
   - status **Approved**.

**Payment (money out):** PM raises a **payment request** against an approved invoice
(partial allowed, capped at remaining payable, with a Low/Med/High **priority** tag)
→ **PD approves** → **Accounts marks paid**. Ageing stops when fully paid.

---

## 5. Advances (on the PO, in Procurement)

- One advance per PO. On the PO, the **PD approves** an advance (amount + its **own
  TDS %**). The vendor is paid **advance − TDS**; **Accounts tracks it as paid**.
- As the vendor's invoices come in, the advance is **consumed** (deducted from the
  payable at the Accounts step) — the **full** advance amount nets down, until used up.
- Report: **total advances not paid** (approved but not yet disbursed).

**Technical:** this needs a small **prior migration to Procurement** adding to
`procurement_orders`: advance fields, fixed-contract window
(`fixed_contract/contract_start/contract_end`), and `billing_branch_id`; plus a
`billing_branches` table and RPCs to set the contract/branch and to approve/pay the
advance. Invoices depend on these, so this migration lands first.

---

## 6. Retention (5% held, released after 12 months)

- Held at the Accounts approval step; a **retention register** row is created with
  **due date = approval + 12 months**.
- On the due date it becomes **payable automatically**; **Accounts marks it paid**.
- **Early release** (before 12 months): **Accounts** can do it, but **only** after a
  **Director requests** it and the **MD approves** (`finance.retention: manage`).

---

## 7. Petty Cash (new company-wide sidebar module)

- **Any employee** logs an entry: optional **project** (or company-level), a
  **category** (from the Billing-managed list), amount, and a **voucher** upload.
  Type is **reimbursement or cash-float** (both supported).
- **Approval chain: Billing → MD → Accounts (pays).** Same chain regardless of
  amount.
- **Visibility:** the person who logged it + the Billing team + Accounts. The logger
  can **export their own entries** as a report.
- Tracked **separately** — petty cash does **not** hit the project budget.
- **Categories** are a fixed list the **Billing team** adds/edits/removes.

**Technical:** its own module `src/modules/pettycash/`, registered as a **general
(company-wide)** module so it appears on the sidebar for everyone. Tables:
`pettycash_entries`, `pettycash_categories`. RLS limits reads to logger + Billing +
Accounts; the 3-step chain and category management go through RPCs.

> ⚠️ **Sanity-check (from N4):** the MD approves **every** petty-cash entry, even a
> ₹200 tea bill. That's what you chose ("same chain"), but it's a lot of MD clicks —
> say the word if you'd rather add a small-amount threshold that skips the MD.

---

## 8. Reports (Finance dashboard, all projects)

A reports page inside Finance showing: **total owed**, **total paid this month**,
**total advances not paid**, **ageing / days-due** per invoice, a per-vendor
**outstanding statement** (invoiced / paid / retention held / still owed), and a
**Tally/accountant CSV export** (approved & paid invoices with GST + TDS split).

---

## 9. Billing branches

A small **Finance Settings** page (Finance Head/Billing) to add/rename **billing
branches**, each with its **GSTIN**. The branch is chosen **on the PO** and carried
onto the bill.

---

## 10. Order of work (migrations + code)

1. **Migration A — Procurement PO extension:** advance fields, contract window,
   `billing_branches` + `billing_branch_id`, and advance approve/pay + contract/branch
   RPCs. _(Invoices depend on this.)_
2. **Migration B — Finance department + core:** create the `finance` department + its
   roles, the **MD** role, register `finance.*` resources; tables for invoices +
   payment requests + retention register; RLS + RPCs; **budget-booking** hook so
   approved invoices feed budget-vs-booked; seed role grants.
3. **Migration C — Petty Cash:** `pettycash_entries` + `pettycash_categories`,
   register `pettycash` as a general module, RLS + the Billing→MD→Accounts RPCs.
4. **Code:** `src/modules/finance/` (index + data/actions + the invoice / payment /
   settings / reports pages, surfaced as a project "Finance" card) and
   `src/modules/pettycash/` (sidebar module + page). Register both in
   `core/modules/registry.ts`.
5. **Gate everything:** `requirePermission` / `authorizeProject` on pages + actions,
   `<Can>` in the UI, activity-feed entries on each approval (L1).
6. `npm run db:push`, then lint + typecheck + build.

---

## 11. Assumptions to confirm (not blockers)

- **MD role placement:** added as a company-wide senior role (like the existing
  back-office roles), not tied to one department. Shout if MD should live elsewhere.
- **MD on every petty-cash entry** — see the §7 warning.
- **Advance payment** isn't a formal request chain; the PD approves it on the PO and
  Accounts records the disbursement ("Accounts keeps track of it", P2).
