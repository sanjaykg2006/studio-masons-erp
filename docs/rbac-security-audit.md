# Access Security Audit — Are the Three Doors Really Sealed?

*A check of how access is actually enforced deep in the system (not just on
screen), looking for holes and for any way the three doors leak into each other.*

Date: 2026-07-02

---

## Overall verdict

**Mostly solid, with one real hole to fix.** The good news: access is genuinely
enforced deep in the database, so hiding a button is not what keeps people out —
the data itself refuses requests it shouldn't allow. A normal employee **cannot**
escalate their own access.

But there is **one important hole**: a **department lead** can quietly promote
themselves (or a teammate) to **full administrator**. There are also a couple of
smaller issues worth tidying. Details below, plainest-first.

---

## 🔴 The one real hole — a department lead can become an admin

**Who could do it:** only a **department lead** (a semi-trusted person you've put
in charge of a department). Not a regular employee.

**What's wrong, in plain English:** there are two "lists" that grant powers:

- the **role list** (used by Door 1) has a **guard** on it — it refuses to record
  any "super" power or any power outside a department's own tools.
- the **per-person team list** (used by Door 2, "People & Access") has **no such
  guard**. It only checks *who* is editing (a lead), not *what* they're granting.

Because the app's normal buttons never offer dangerous powers, you'd never see
this on screen. But a department lead could send a direct request to the system
and write themselves the "everything" power. From that moment the system treats
them as a full admin — they could open Access Control, change other departments,
delete users, and so on. That breaks the wall between Door 2 and Door 1.

**A second, related leak (same root cause):** a Design lead could also hand
themselves an over-powered "works on every project" role by editing the team
record directly (the normal screen only lets them pick a proper Design role, but
the underlying list doesn't re-check that).

**Why it exists:** the team lists trust *who* is editing but never check *what* is
being granted, and — unlike the role list — they have no automatic guard behind
them.

**The fix (small, safe):** add the same kind of guard to the two team lists that
the role list already has:
- never allow the "everything" power or the "Access Control" power to be granted
  through a department, and
- only allow a person's "all projects" role to be one of that department's own
  roles.

This is a database-only change (no screen changes) and I can write it for you.

---

## 🟠 Smaller issues worth tidying

1. **"Works on all projects" only actually works for Design.** For any other
   department (e.g. Project Management), turning this switch on currently grants
   nothing — the underlying rule is hard-wired to Design. Not a security hole, but
   a real gap now that other departments exist.

2. **"Access Control" must never be marked a "general" screen.** If an admin ever
   ticked Access Control as a company-wide/general screen, the role guard would
   then let it be handed out inside departments — a back-door into Door 1. Today
   it isn't, but the fix above should also hard-block it so a wrong tick can't
   ever open that door.

3. **Any department lead can see everyone's name and email** (not just their own
   department's). This is needed for the "add a person" picker, so it's a
   deliberate trade-off, but worth knowing.

---

## 🟢 What is properly sealed (the reassuring part)

- **Regular employees cannot raise their own access.** They can only see their own
  access records, and the system blocks them from changing their own role.
- **The role list and self-role-change are guarded** (Door 1 is well protected at
  the role level).
- **Project data is gated per project.** You only see/act on a project if your
  project role (or a genuine department-wide grant) allows it. The
  **Concept/Technical privacy** holds — one sub-team can't see the other's tasks
  unless deliberately shared or you're a senior/admin.
- **Sub-team changes and most sensitive edits happen only through controlled
  routines** that re-check permission every time.
- **Everything is deny-by-default** and enforced in the database, so the three
  doors are real walls, not just screen layout.

---

## Recommended next step

Fix the one real hole (and fold in smaller issues #1 and #2) in a single small
database update:

1. Guard the per-person team list so it can never grant "everything" or "Access
   Control", and only department-owned modules.
2. Guard the team record so an "all projects" role must belong to that department.
3. Make "works on all projects" apply to every department, not only Design.

None of this changes any screen; it only closes the gaps behind them.
