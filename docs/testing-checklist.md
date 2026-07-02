# Testing checklist — what's been built (as of 2026-07-02)

A plain-English guide to everything recently added, so you can test it end to end.
Work through it top to bottom. Each item says **what it is**, **how to switch it on**,
and **what to click to check it works**.

> **Legend:** ⬜ = to test · ✅ = passed · ❌ = found a problem (note what happened)

---

## 0. First: apply the database migrations

Nothing below works until these are applied to your live database. Run each with
`npm run db:push` (they apply in order; newest is 0036, so no `--include-all` needed).

| Migration | Adds | Applied? |
|---|---|---|
| `0034_rfi_attachments.sql` | Documents on RFI questions/replies + clearer role display | ⬜ |
| `0035_rfi_target_role.sql` | Raise an RFI straight to a chosen role | ⬜ |
| `0036_procurement_department.sql` | Procurement department + vendor directory | ⬜ |
| `0037_procurement_budget.sql` | Per-project Budget BOQ (versioned) | ⬜ |
| `0038_procurement_intents.sql` | Per-project purchase intents | ⬜ |
| `0039_procurement_comparison.sql` | Comparison + per-project vendor list | ⬜ |

**How to confirm they're on:** run `npx supabase migration list` — the Local and Remote
columns should both show `0034` … `0039`.

---

## 1. RFI — attach documents to a question or reply

**What it is:** on a project's *Questions (RFIs)* card you can now attach files to the
opening question and to any reply/answer. Files are private; you get a secure download
link on click.

**Where:** open any project → scroll to **Questions (RFIs)**.

- ⬜ Click **Ask a question**, pick a department, type a subject + question, and use
  **Attach documents (optional)** to add a file. Send it.
- ⬜ Open the question — the file appears under the opening message with a **download**
  icon. Click it: the file opens/downloads.
- ⬜ Reply to a question with a file attached — it shows under your reply.
- ⬜ **Remove** a file with the trash icon (your own file, or as a dept lead/admin).
- ⬜ Try a file over 25 MB — it should be refused with a clear message.
- ⬜ Attaching a file to a **brand-new** question with no text typed → it asks you to
  write the question first (the file needs a message to attach to).

## 2. RFI — clearer "current role" display + escalation

**What it is:** each question shows, in bold, which role it currently sits with, and marks
**(most senior)** once it's at the top. The **Escalate** button greys out at the top
instead of throwing an error.

- ⬜ On a question, read the grey line: `… · with **<role>**`.
- ⬜ **Escalate** a question a few times — the role climbs up the ladder each time.
- ⬜ At the top of the ladder it says **(most senior)** and the Escalate button is
  disabled (hover shows "Already with the most senior role").

> If the role names look wrong (e.g. a "junior" question sits on a senior-sounding role),
> that's the **seniority order not being set**. Fix it in the next item.

## 3. Seniority order (needed for RFIs to make sense)

**What it is:** each department's roles have a seniority order that drives where a question
starts and how it escalates. It was auto-created alphabetically, so set it properly once.

**Where:** **Departments → pick a department → Settings → Order (top = most senior)**.

- ⬜ Drag the roles into true seniority order (topmost = most senior).
- ⬜ Go back to a project and raise a new question to that department — it should now
  start at the **most junior** role and escalate upward correctly.

## 4. RFI — raise straight to a specific role

**What it is:** when asking a question you can aim it at a specific role instead of always
starting at the most junior, and it still escalates upward from there.

**Where:** project → **Questions (RFIs)** → **Ask a question**.

- ⬜ Pick a department — a second dropdown appears: **"Send to: …"**.
- ⬜ Leave it on **"most junior role (default)"** → question starts at the bottom (old
  behaviour).
- ⬜ Choose a specific role (top one is marked **(most senior)**) → the new question shows
  it sits **with that role**.
- ⬜ **Escalate** that question → it climbs to the next role *above* the one you chose.

---

## 5. Procurement — the vendor directory (module slice 1)

**What it is:** a brand-new **Procurement** department with its first screen — a company
vendor directory (suppliers / subcontractors / service providers). A new vendor stays
**Pending** until Finance approves it.

**Switch it on (permissions):** the **Procurement** sidebar link only shows if you can
read vendors. To grant it:
- Easiest for testing: use an **admin** account (wildcard) — the link shows automatically.
- Or on **Access**, give a role the *Procurement · Vendors* verbs.
- Or on the new **Procurement** department's **Team Access**, tick the verbs per person.

**Where:** sidebar → **Procurement**.

- ⬜ The **Procurement** link appears in the sidebar and opens the **Vendor directory**.
- ⬜ **Add vendor** → fill name (required), type, trade, contact → **Save**. It appears in
  the list as **Pending**.
- ⬜ **Edit** a vendor (pencil icon) → change a detail → **Save**.
- ⬜ **Approve** a vendor (tick icon) → badge turns **Approved**; hovering shows who
  approved it. **Reject** (X icon) → badge turns **Rejected**.
  - Note: approving needs the **approve** verb. It's deliberately *not* granted to the
    Procurement roles (that's Finance's job) — so only an admin, or whoever you grant
    `procurement.vendor:approve`, can approve. This is intentional separation of duties.
- ⬜ **Remove** a vendor (trash icon) — asks to confirm, then it's gone.
- ⬜ Sign in as someone **without** procurement access → the sidebar link is hidden and
  visiting `/procurement` bounces to the Forbidden screen.

---

## 6. Procurement — per-project Budget BOQ (module slice 2)

**What it is:** each project now has a **Budget BOQ** — the budgeted quantities and rates,
grouped into packages, that will later cap what can be ordered. It's versioned: you edit a
**draft**, then **release** it (which locks it); revising a released budget opens a fresh
version and needs Director approval.

**Switch it on (permissions):** the budget is per-project and uses `procurement.budget`.
Procurement roles already carry it (Manager: read/create/update/delete; team member:
read/create/update); the Director's re-version **approve** is granted via /access. Easiest
for testing: an **admin** account. To confirm the whole chain, add someone to the
**Procurement** team (Team Access) with the budget verbs and test as them.

**Where:** open a project → **Procurement** card → **Budget BOQ** (or go straight to
`/projects/<id>/budget`).

- ⬜ On a project with no budget, the card links through and you see **"no budget yet"** +
  **Start budget** (needs create). Click it → a **Draft v1** appears.
- ⬜ **Add package** (e.g. "Civil works"). It appears as a section.
- ⬜ In a package, use the bottom row to **add a line** (ref, description, unit, qty, rate)
  → **+**. The **Amount** column and the package/grand totals compute automatically.
- ⬜ **Edit a line** (pencil) → change qty/rate → save (tick). **Delete** a line (trash).
- ⬜ **Rename** a package (pencil by its name); **delete** a package (trash) — confirms first.
- ⬜ Click **Release** → the version badge turns **Released** and the whole thing becomes
  read-only (the add/edit controls disappear).
- ⬜ As an approver, click **New version** → a fresh **Draft v2** opens, **copied** from v1.
  Edit it; the version dropdown lets you switch back to v1 (read-only).
- ⬜ Someone **without** `procurement.budget` on the project: no Procurement card, and
  `/projects/<id>/budget` bounces to Forbidden.

## 7. Procurement — purchase intents (module slice 3)

**What it is:** a **Project Manager** raises a **purchase intent** — a request to buy against
the released Budget BOQ. Each line picks a budget line + a quantity. If the requested
quantity would push the cumulative approved quantity past the budgeted quantity, the line is
flagged **Over budget**. The **Director approves** (or rejects) the intent; approving an
over-budget line records the bypass. The raiser can withdraw their own pending intent.

**Switch it on (permissions):**
- **Raising** needs `procurement.intent:create` — seeded onto the **Project Manager** role
  (`pm_project_manager`). So test raising as a user who is a **member of the project with the
  Project Manager role**.
- **Approving** needs `procurement.intent:approve` — a **Director**-level company-wide grant;
  assign it via **Access** (or use an admin).
- Procurement team members get read-only visibility.

**Where:** project → **Procurement** card → **Purchase intents** (or `/projects/<id>/intents`).

- ⬜ **Pre-req:** the project must have a **released** budget (slice 2) with some lines.
- ⬜ As the **Project Manager**, click **Raise intent** → set *Needed by*, pick a budget line,
  enter a quantity within budget → **Add line** for a second one → **Raise intent**. It
  appears as **Pending**.
- ⬜ Raise another intent with a quantity **larger than what's left** on a line → the form
  shows **Over budget**, and after raising, the intent carries an **Over budget** flag.
- ⬜ Expand an intent (click it) → see its lines with budgeted vs requested quantities.
- ⬜ As the **Director/admin**, **Approve** a within-budget intent → turns **Approved**.
- ⬜ **Approve** the over-budget one → it still approves, and its over-budget line shows
  **"cleared by <name>"**.
- ⬜ **Reject** a pending intent → turns **Rejected**.
- ⬜ As the raiser, **withdraw** (trash icon) a pending intent → it disappears.
- ⬜ After approving intents, raise a new one on the same line — the **"left"** quantity in the
  picker has gone down by the approved amounts.

---

## 8. Procurement — comparison + approved vendors (module slice 4)

**What it is:** the **Procurement Manager** builds a **comparison** from a released budget
package (its lines copy in), adds the vendors being compared, and enters each vendor's **rate**
per line. The **Director awards** each line to a winner (same vendor everywhere = a whole
package; different vendors = a split). Winners are added to the project's **approved-vendor
list** (which you can also edit by hand).

**Switch it on (permissions):**
- **Preparing** a comparison needs `procurement.comparison:create` — seeded on the
  **Procurement Manager / team** roles (held company-wide via Team Access on the Procurement
  department, or as a global role).
- **Awarding** needs `procurement.comparison:approve` — a **Director**-level company-wide grant
  (assign via Access, or use an admin).

**Where:** project → **Procurement** card → **Comparisons** (or `/projects/<id>/comparisons`).

- ⬜ **Pre-req:** a **released** budget with at least one package + lines, and some **Approved**
  vendors in the directory (section 5).
- ⬜ As the **Procurement Manager**, **New comparison** → pick a package → it opens with the
  package's lines down the left.
- ⬜ **Add a vendor to compare** (only *approved* vendors appear) → a column appears. Add two
  or three.
- ⬜ Type a **rate** into cells and click away — it saves. Clear a cell to remove that quote.
- ⬜ As the **Director/admin**, in the **Awarded** column pick a winning vendor per line (only
  vendors you quoted show) → **Confirm award**. The comparison locks; winning cells go green.
- ⬜ Back on the comparisons page, the winners now appear under **Approved vendors for this
  project**.
- ⬜ As an approver, **add** another approved vendor to that list by hand, and **remove** one
  (trash icon).
- ⬜ Re-open an **awarded** comparison → it's read-only and shows each line's winner + amount.

---

## What's NOT built yet (so you don't go looking)

Still planned, not implemented: **purchase orders / amendments and goods receipts** (one PO per
awarded vendor), and **Excel import** of the Budget BOQ / comparison workbooks (entry is manual
for now). See [procurement-module-plan.md](procurement-module-plan.md) for the full plan.
