# Studio‑Masons ERP — Director's Report

*Assessment date: 30 June 2026. No technical knowledge assumed.*

> This report supersedes the earlier `ERP-Review-Report.txt` and
> `ERP-Remediation-Plan.txt` (dated 23 June 2026), which are now partly out of
> date. It reflects the codebase, database, tests, CI pipeline, and the fresh
> Supabase security scan as of 30 June 2026.

---

## 1. Executive Summary

Studio‑Masons ERP is a custom, in‑house business system being built from scratch
to eventually run multiple parts of the company ("modules") on one secure web
platform.

**The headline since the last review (one week ago) is real, visible progress.**
A week ago this was, in plain terms, a well‑built but empty office building —
strong foundations, no offices fitted out. That has changed in two important
ways:

1. **The first genuine business tool now exists: the Design Department module.**
   Staff can create design projects, fill in structured project briefs from
   reusable questionnaire templates, track a project through its stages, manage
   project folders and files, control who sees what on each project, log change
   requests, and automatically file an approved brief as a PDF. This is no longer
   a demo — it is a working department tool with roughly 36 distinct server
   operations behind it.

2. **Most of the "make it safe to operate" gaps from the last review have been
   closed.** In the past week the developer has added: an automated test
   safety‑net, an automated quality gate that runs on every change, an "invite a
   user" screen (so adding staff no longer needs a developer), an audit/activity
   log that records who did what, a proper version‑controlled database‑change
   process, and backup tooling. That is an unusually strong response to a review.

**The security and permissions system remains the standout strength** — and it
has grown more sophisticated. Access is now split into three independent "doors":
back‑office job titles, per‑department team access, and per‑project access.
Crucially, all of these rules are enforced inside the database itself (the
strongest possible place), not just hidden on screen. The most recent independent
database scan found **no unprotected data tables** — every table is locked down.
That is a very good result.

**Where the caution now lies** has shifted from "is anything built?" to "is the
build settling down, and is it being hardened?" Three things stand out. First, a
fresh automated security scan returned **72 warnings** (all medium‑severity, none
critical) that need a triage pass — mostly database functions that are
technically reachable before sign‑in. Second, the access‑control system has been
**redesigned repeatedly in a short window** (re‑architected just days ago), which
is healthy if it is now stabilising but risky if it keeps churning. Third, there
is an **ambitious re‑architecture plan on paper** (a company‑wide Projects world,
cross‑department request‑for‑information tickets, project lifecycle phases) that
is well thought out but not yet built — and represents a large amount of future
work that needs a dated plan and disciplined scope.

**Bottom line:** The project has moved decisively from "foundations only" to
"first real value delivered, operating safety‑rails largely in place." The
engineering quality remains high and the developer has been responsive. The
conversation to have now is about **hardening (security warnings, MFA, tested
backups), reducing reliance on a single developer, and agreeing a realistic,
dated roadmap** for the large module work still ahead — before the system carries
live company data.

---

## 2. Top 10 Concerns to Discuss With the Developer

1. **The 72 open security warnings — what's the plan to clear them?** A database
   scan flagged 70+ internal functions that are technically callable before a
   user signs in, plus password‑leak protection being switched off. These are
   warnings, not active breaches, and many likely self‑protect — but they need a
   deliberate triage and sign‑off, not silence. Ask for a written response: which
   are real, which are false alarms, by when.

2. **Is the access‑control system now stable, or still being redesigned?** The
   permissions model — the heart of the system — has been re‑architected very
   recently. Ask the developer to confirm it is now settled, because repeated
   rework here is where subtle, hard‑to‑spot security bugs creep in.

3. **A large re‑architecture is planned but not built — what's the dated
   roadmap?** There's an excellent plain‑English design document for a much bigger
   system (company‑wide projects, cross‑department tickets, lifecycle phases).
   It's a lot of work. Ask for the first 3–4 things to build, in order, with
   target dates, and what "version 1 staff actually use" must contain.

4. **Multi‑factor authentication (MFA) is still not in place.** Login is solid and
   invite‑only, but a single leaked password is currently enough to get in.
   Confirm whether MFA will come via Supabase or via the planned Microsoft 365
   sign‑on, and when.

5. **Backups exist but appear to be a one‑off, not automated or tested.** Backup
   tooling was created, but the only backups on record are from the day it was set
   up. A backup you've never restored isn't a backup you can trust. Ask for:
   automated scheduled backups + one documented test restore.

6. **Key‑person / "bus factor" risk remains.** Everything still depends on one
   developer. Confirm the **company** owns all accounts, the code repository, and
   the hosting — not a personal account — and that a second person could deploy
   and recover the system from written instructions.

7. **Changes still go straight to the live "main" version.** The automated quality
   gate is now in place (good), but there's no enforced second pair of eyes before
   changes land. As real data arrives, consider requiring review before merge.

8. **No live error monitoring yet.** If something breaks for a user in production,
   no one is automatically alerted — you'd hear it from a complaint. This is a
   small, cheap addition (e.g. Sentry) that should go in before real use.

9. **Microsoft 365 single sign‑on is still pending external access.** The system
   is designed to drop it in easily, but it's blocked on Azure admin permissions
   the developer doesn't yet have. Decide who in the business unblocks that, as it
   also delivers MFA "for free."

10. **Is the test safety‑net keeping pace with the new features?** Tests now exist
    (good), but they cover the core permissions logic, not yet the large new
    Design module. Agree the principle: "a feature isn't done until it has a
    test," so coverage grows with the system rather than falling behind.

---

## 3. Status Report — Red / Yellow / Green

| Area | Status | Comment |
|---|---|---|
| **Code quality & structure** | 🟢 Green | Clean, consistent, modern, well‑documented. Genuinely strong engineering. |
| **Security & permissions (data layer)** | 🟢 Green | Enforced in the database; scan found **no unprotected tables**. Strongest part of the project. |
| **Technology choices** | 🟢 Green | Mainstream, well‑supported, cost‑effective, easy to hire for. |
| **Architecture for growth** | 🟢 Green | Built so new modules slot in quickly; first real module proves the pattern. |
| **Testing & quality gate** | 🟢 Green | Automated tests + an automated build/lint/test gate on every change. Closed since last review. |
| **Database‑change process** | 🟢 Green | Now version‑controlled and repeatable, not hand‑pasted. Closed since last review. |
| **Business value delivered** | 🟡 Yellow | First real module (Design) is working — a big step up from "nothing." Other departments and the wider Projects system are still to come. |
| **User & staff management** | 🟡 Yellow | "Invite a user" + audit log now exist. Solid, but new and lightly tested. |
| **Security hardening** | 🟡 Yellow | 72 medium‑severity scan warnings open; needs a triage pass. None critical. |
| **Login depth (MFA)** | 🟡 Yellow | Invite‑only and solid, but still no second factor; M365 sign‑on pending. |
| **Operational resilience** | 🟡 Yellow | Backup tooling exists but isn't automated or test‑restored; no live error alerting yet. |
| **Stability of access model** | 🟡 Yellow | Powerful but recently re‑architected; needs to prove it has settled. |
| **Key‑person / continuity risk** | 🔴 Red | Still a single developer; company ownership of accounts and a recovery runbook need confirming. |

**Overall: 🟡 Yellow, trending positively.** A week ago the project had three red
areas; most have turned green through genuine work. The remaining cautions are
about **hardening and continuity**, not basic quality — the right concerns for a
system approaching live use.

---

## 4. Features With the Biggest Business Value Next

Ordered by recommendation. The first group protects you; the second delivers
visible value.

**Tier 1 — Lock down what's already built (do first, mostly cheap):**

1. **Clear the security warnings + turn on MFA.** Triage the 72 findings, switch
   on password‑leak protection, and add a second login factor (ideally via
   Microsoft 365 sign‑on, which solves both at once). This is the gate before any
   real company data goes in.
2. **Automated, tested backups + error alerting.** Schedule backups, do one
   documented test restore, and connect live error monitoring. Small effort, large
   protection.

**Tier 2 — Finish and widen the working module (highest visible value):**

3. **Complete the Design module to a "version 1" staff use daily.** It's the
   furthest along and closest to ROI. Define exactly what it must do to go live
   for the design team, and get it into real hands. A finished, in‑use module is
   worth more than three half‑built ones — and it becomes the proven template for
   every other department.
4. **Build the company‑wide Projects "spine"** from the design document — one
   place where projects live, with their teams, briefs and folders — since every
   future department plugs into it. This is the single highest‑leverage structural
   piece; it just needs a dated, scoped plan first.

**Tier 3 — The cross‑department workflow (the differentiator), once the spine
exists:**

5. **The RFI (Request‑for‑Information) ticket system** — letting one department
   formally ask another a question on a project, with escalation. This is the
   feature that turns the ERP from a set of separate tools into a system that runs
   the business across departments. Valuable, but sequence it *after* the Projects
   spine and the hardening work.

**Recommendation:** Commission **Tier 1 as a single hardening block now** (it's
mostly configuration and makes the system safe to operate), agree the **dated
roadmap (Concern #3) in parallel**, then drive the **Design module to a real
"go‑live"** before opening the larger Projects re‑architecture. Resist building
several departments at once — depth on one beats breadth on many.

---

*A note on what changed since 23 June: the developer closed five of the last
review's biggest gaps (tests, quality gate, user invites, audit log, database
process) within a week and shipped the first real module. That responsiveness is
itself a positive signal worth acknowledging.*
