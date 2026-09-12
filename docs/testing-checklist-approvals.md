# Testing checklist — access & approvals (11–12 Sep 2026)

Everything built on 11 and 12 September, in the order it is easiest to test.
Migrations **0078–0091**. Tick as you go; anything that fails, note what you saw.

**Before you start**

- [ ] All migrations applied: `npx supabase migration list --linked` shows 0078–0091 on both sides.
- [ ] The site has rebuilt on Vercel since the last push.
- [ ] You are signed in as **Sanjay (Administrator)** — full access, so most things are visible.
- [ ] Have a second account to hand (e.g. **Prem Kumar**, Director) to check what a non-admin sees.

---

## 1. Where each permission lives (0078, 0086)

- [ ] **Access Control → a department → "Modules in …"** groups modules under **Project work**,
      **Department tools** and **Settings grids**, each with a line saying where a ticked module shows up.
- [ ] **Access Control → "Where each module is set"** lists every module with three choices:
      **Job title**, **People & Access**, **Project roles**. Options a module can't use are greyed out —
      hover one for the reason.
- [ ] Move a module (e.g. **Procurement · Vendors** → Job title). You are warned that ticks in its old
      place will be cleared; after saving it appears in the Back Office matrix and has left
      Procurement's People & Access. **Move it back** afterwards.
- [ ] A department's **People & Access** shows only: Tasks, Settings, People & Access, plus that
      department's tools. No "Projects" row, no Petty Cash.
- [ ] A department's **Settings → Project roles** shows only project work, and lists its department
      tools underneath as "set per person on People & Access".

## 2. Job titles: order and delegation (0078, 0083)

- [ ] **Access Control → Back Office → Job titles** has up/down arrows; the order is
      Administrator, Managing Director, Co-Founder, Director, Staff (or as you have rearranged it).
- [ ] The department lead automatically has **Tasks**, **Settings** and **People & Access**;
      only a lead (or you) can hand out Settings / People & Access.
- [ ] Tick **Tasks → Create** for a non-lead teammate: they can create tasks on that department's board.

## 3. IT department (0085)

- [ ] **Departments → IT** shows cards for **Access Control**, **Activity Log**, **Error Log**,
      plus Tasks / People & Access / Settings.
- [ ] **IT → People & Access** can hand out Activity Log and Error Log.
- [ ] Only you (Administrator) can tick **Access Control** there — the note says so.

## 4. Projects (0079, 0080, 0087)

- [ ] **Settings → Project roles** has a **Projects** row whose *Create* says
      "Create = can start new projects". A role with it ticked can start a project.
- [ ] **Project · Templates** appears in Project roles (not People & Access); a role with *View*
      can open **Projects → Templates**.
- [ ] **Every-project role:** with "Give this person a role on every project" on, that person sees
      every project, gets that role's buttons on each, and appears in each project's team list
      marked **"every project"** with no Remove button.
- [ ] Each project's team list shows the **role name** for every member (no dashes).
- [ ] **Project · Change orders** appears in Project roles with View / Create / Approve.

## 5. Petty Cash (0081, 0082, 0088, 0089)

- [ ] **Log a spend** has **"Pay by (optional)"**; it refuses a date before the spend date.
- [ ] The list shows a **Due** column, and a claim past its date shows **"N days overdue"** in red.
- [ ] The summary panel (top of Petty Cash, and on the **Finance** department page for Billing /
      Accounts / MD) shows open, overdue, due in 7 days, paid this month, the per-stage split and
      the most overdue claims.
- [ ] "Export mine" includes the pay-by date and days overdue.
- [ ] A new claim shows **"Awaiting Billing check"**; the Billing person sees Approve / Reject.
- [ ] After the Billing check it shows **"Awaiting Senior approval"**; a Director can approve a
      Staff claim, but not their own.
- [ ] A claim from the **Managing Director or Co-Founder** skips senior approval and goes straight to
      **Awaiting Accounts**.
- [ ] Accounts sees **Pay**; nobody can pay their own claim.

## 6. Approval flows: the page and the editor (0089–0091)

- [ ] **Access Control → "Approval flows — who approves what"** (also on the IT page) lists every
      flow, its steps in order, the tick each needs, who can do it right now, and a "Change it" link.
- [ ] Flows with **editable stages** are badged, and show an **"Edit the approval stages"** box:
      Petty Cash, Change orders, Purchase intent, Vendor, Brief, Brief revision, Vendor invoice,
      Payment request, PO advance, Early release of retention, Purchase order.
- [ ] **Add a stage** to Petty Cash — e.g. "Director sign-off", *Anyone with a tick* →
      Petty Cash · Senior approval → Approve, **only for amounts of ₹5,000 or more** — and reorder it.
- [ ] A claim **below** that amount skips the new stage; one **above** it waits for it.
- [ ] Editing stages does **not** disturb claims already in progress (they keep the stages they started with).
- [ ] Try each "who approves" kind once: **a tick**, **someone senior to the requester**,
      **the requester's department lead**, **a specific job title**.
- [ ] Tick **"the requester's department lead may give it too"** on a stage and check that lead can approve.
- [ ] With **"the requester can't approve their own"** on, the requester sees no buttons and gets a
      clear message if they try.
- [ ] Delete a stage you added; the flow returns to its old shape for new items.

## 7. Each flow end to end

Default stages reproduce the old behaviour, so these should all work as they always did.

- [ ] **Change order:** raise one on a project → it shows "Waiting for: Approve" → approve it.
      Rejecting asks for a reason and records it.
- [ ] **Purchase intent:** raise one → approve. If a line already has a live PO, approving still
      opens that PO's **amendment** (check the PO shows "Amending" and a new version).
- [ ] **Vendor:** add a vendor → it shows Pending with its stage → approve it. A rejected vendor can
      still be re-statused by Finance afterwards.
- [ ] **Brief:** submit for review → the approver sees Approve / Return for changes → approve.
      The **brief PDF** appears in the Project Brief folder, and the project moves to
      **Brief approved** once every brief is approved.
- [ ] **Brief revision (after a Design Freeze):** propose → submit → approve & publish. The published
      answers update and the PDF is re-filed. Returning it puts it back to draft.
- [ ] **Vendor invoice:** enter one → it waits for its stage → approve → Accounts **books** it.
      Check the booked figures (GST, TDS, retention, advance) are exactly as before.
- [ ] **Invoice over the PO cap:** the stage refuses to approve until **Override cap** is used.
- [ ] **Payment request:** raise → approve → Accounts marks it paid. **Reject** one and check the
      amount is freed back on the invoice.
- [ ] **PO advance:** request on a PO → approve → Accounts pays. **Turn one down** and check the
      request is cleared so it can be asked for again.
- [ ] **Early release of retention:** request → approve → pay. Retention that reaches its 12-month
      date still goes straight to Pay with no approval.
- [ ] **Purchase order:** generate POs from an approved intent → the PO shows
      **"Waiting for Finance review"** → give it → **"Waiting for Director approval"** → give it →
      **Release PO** becomes available.
- [ ] **Refuse** a PO sign-off: the PO stays a draft, shows "Sign-off refused", and
      **Send for approval** starts it again.
- [ ] **Amend** an issued PO: it goes back through its stages before it can be released again.
- [ ] An **over-budget** PO still needs the senior override before release.
- [ ] The **purchase orders list** shows each PO's stage (or Signed off / Refused).

## 8. Safety checks

- [ ] Nobody can approve **their own** item where the stage says so (including you as Administrator).
- [ ] A person without a stage's tick sees **no buttons**, and a clear message if they try anyway
      (e.g. "This is waiting for 'Director approval', which you can't give").
- [ ] As Administrator you can act on **any** stage as a backup.
- [ ] The **Activity Log** (IT → Activity Log) records approvals, rejections and stage edits.

## 9. Things that should NOT have changed

- [ ] Invoice booking maths: base, GST, other charges, TDS, advance, 5% retention, amount payable.
- [ ] The PO document (numbering, billing branch, GST block).
- [ ] Goods receipts, budget release and re-versioning, project finalise / Design Freeze.
- [ ] Task board, folders and files, RFIs.
