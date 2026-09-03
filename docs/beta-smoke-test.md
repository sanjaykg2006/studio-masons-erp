# Beta smoke test — one pass through the whole ERP

*Run this straight after the beta reset ([`scripts/reset-for-beta.sql`](../scripts/reset-for-beta.sql)),
before you let anyone else in.*

The two deep checklists — [`testing-checklist.md`](testing-checklist.md) (RFI +
Procurement) and [`testing-checklist-newest-modules.md`](testing-checklist-newest-modules.md)
(Inventory, Finance, Petty Cash) — cover each module in detail. **This one is
different**: it walks the *spine* of the system in the order real work happens,
so a break anywhere in the chain shows up. It takes about 45 minutes.

> **Legend:** ⬜ to do · ✅ passed · ❌ broke (write down what you clicked and what happened)

---

## 0. Before you start

| Check | How | ⬜ |
|---|---|---|
| Database is up to date | `npx supabase migration list` — Local and Remote both reach `0067` | ⬜ |
| You have a fresh backup | `npm run db:backup`, folder copied off the machine | ⬜ |
| You can sign in | Your account still works after the reset | ⬜ |
| You're still an admin | You can open **Access** — if not, stop; your role didn't survive | ⬜ |

You'll need **two accounts** for this: yours (admin) and one ordinary test person
you invite in step 1. Most of what can go wrong in beta is someone seeing
something they shouldn't, and you can't catch that from an admin account.

---

## 1. Setup survived the reset

| Check | Where | ⬜ |
|---|---|---|
| Roles and their ticks are intact | **Access** → the permission matrix has your roles, not an empty grid | ⬜ |
| Departments still exist, with modules allotted | **Departments** → each has its tools switched on | ⬜ |
| Brief templates survived | **Projects → Templates** → your templates are listed, with versions | ⬜ |
| Folder rules survived | Department settings → folder access grid still has ticks | ⬜ |
| Billing branches survived | **Finance → Settings** | ⬜ |
| Petty-cash categories survived | **Petty Cash** settings | ⬜ |
| Vendor list is empty | **Procurement → Vendors** — should be blank (we cleared it) | ⬜ |
| Activity log is empty | **Logs / Activity** — a clean slate | ⬜ |

If any of the first six are empty, **stop and restore the backup** — the reset
took more than it should have.

---

## 2. Invite a person (this also proves email works)

| Step | ⬜ |
|---|---|
| **Access → Invite**, enter a real address you can open, give them a job-title role | ⬜ |
| The invite email actually arrives | ⬜ |
| The link lets them set a password and sign in | ⬜ |
| They land on a mostly-empty app — no projects, no money screens | ⬜ |
| Their name appears in **Access** with the right role | ⬜ |
| The invite shows up in the **Activity log**, with your name against it | ⬜ |

> **This is the single most important step.** If invites don't send, beta doesn't start.

---

## 3. The project spine — do these in order

Each step depends on the one before it. Stop at the first ❌; later steps will
fail for the wrong reason.

| # | Step | What proves it worked | ⬜ |
|---|---|---|---|
| 1 | Create a project | It appears in **Projects** | ⬜ |
| 2 | Add your test person as a member, with a project role | They can now see the project; before this they couldn't | ⬜ |
| 3 | Fill in a brief from a template | Answers save; a revision is recorded | ⬜ |
| 4 | Upload a file into a project folder | It uploads, and downloads back | ⬜ |
| 5 | Raise an RFI to a role, reply to it, attach a document | Both messages and the file appear | ⬜ |
| 6 | Create a task, assign it to your test person | They see it; you see it on the board | ⬜ |
| 7 | Pause the task, then resume it | Only the person who assigned it can pause | ⬜ |
| 8 | Import or enter a **Budget BOQ** | Lines and packages appear, totals look right | ⬜ |
| 9 | Raise a **purchase intent** against a budget line | It routes for approval | ⬜ |
| 10 | Approve the intent | Status moves on | ⬜ |
| 11 | Enter **vendor rates** for the package | Rates save against a vendor | ⬜ |
| 12 | Raise a **PO** and issue it | PO document generates, with the vendor's GST and address on it | ⬜ |
| 13 | Upload the vendor's acceptance letter | PO is now ready for invoicing | ⬜ |
| 14 | Record a **goods receipt** (part of the quantity) | Received quantity updates | ⬜ |
| 15 | Check **project Inventory** | Received / consumed / on-hand match what you just did | ⬜ |
| 16 | Enter a **vendor invoice** against the PO | ⭐ **Check the maths by hand** — tax, retention, advance | ⬜ |
| 17 | Approve and book the invoice | It appears in the Finance dashboard | ⬜ |
| 18 | Raise a **payment request** | It routes correctly | ⬜ |
| 19 | Log a **petty cash** entry with a receipt | It appears against the right category | ⬜ |
| 20 | Add a **company asset**, transfer it to another person | They must accept it before it moves | ⬜ |
| 21 | Open the **Finance reports** | Budget vs expenditure reflects everything above | ⬜ |

**Step 16 deserves real attention.** It's the only place where a quiet arithmetic
error costs money rather than causing a visible crash. Work one invoice out on
paper and compare.

---

## 4. Permissions — the spot-checks that matter

Sign in as your **test person**, not as yourself.

| Check | Expected | ⬜ |
|---|---|---|
| Open a project they're **not** a member of (paste the URL) | Blocked | ⬜ |
| Open **Access** | Blocked | ⬜ |
| Open **Finance** without a finance role | Blocked | ⬜ |
| Open another department's screens | Blocked | ⬜ |
| Remove them from the project, then reload | They lose access immediately | ⬜ |
| Give them a department lead role — can they make themselves admin? | **No.** The database refuses it | ⬜ |

That last one is the hole found in the [access audit](rbac-security-audit.md) and
closed in migration `0031`. It's worth re-proving on live data before beta, because
it's the failure that would matter most.

**Paste the URL — don't just look at the menu.** A hidden button proves nothing;
the real test is whether the address bar gets you in.

---

## 5. While beta is running

- **Watch [`/logs`](../src/modules/errorlog)** — the error log records real failures
  with the user's own note attached. Check it daily. This is your early warning.
- **Check the Activity log** — it shows who did what, department by department.
- **Keep backing up**: `npm run db:backup` before any change, and at the end of each
  beta week.
- **Tell testers how to report**: what screen, what they clicked, what they expected.
  A screenshot of the error page (it carries an error id) is worth ten sentences.

---

## What "nothing goes wrong" actually means here

You cannot prove an ERP is bug-free, and chasing that will delay beta forever. What
this pass gives you is narrower and more useful: **every screen has been opened at
least once on the real database, the money maths has been checked by hand, and the
walls between people have been tested from the wrong side.** Bugs found after that
are the ordinary kind — reported, fixed, moved past. The ones this catches are the
kind that would have you restoring a backup in week one.
