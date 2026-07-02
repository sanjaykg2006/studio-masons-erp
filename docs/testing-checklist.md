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

**How to confirm they're on:** run `npx supabase migration list` — the Local and Remote
columns should both show `0034`, `0035`, `0036`.

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

## What's NOT built yet (so you don't go looking)

The rest of Procurement is planned but not implemented: **budget BOQ, purchase intents,
comparison, purchase orders/amendments, and goods receipts**, plus the **per-project
approved-vendor list**. These are the next slices. See
[procurement-module-plan.md](procurement-module-plan.md) for the full plan.
