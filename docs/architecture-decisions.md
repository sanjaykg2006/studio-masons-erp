# ERP Architecture — The Whole Picture (Plain English)

This captures every decision we made together about how the system is organised:
modules, access, projects, departments, the RFI system, and the Concept/Technical
rule. No technical words. Read it, correct anything, and fill the one gap at the
end (the project initialisation flow). **Nothing is built until you approve this.**

---

## 1. The big idea: two separate worlds

Everything in the company splits into two worlds that do not interfere:

1. **Department world** — what happens *inside* a department (Design, MEP,
   Interior, Site…). Internal tasks, tracking, internal chat. Private to that
   department. Controlled by **Team Access**.

2. **Projects world** — one company-wide place where actual projects live. A
   project is worked by *several* department teams at once. Briefs, folders, and
   the cross-department RFI ticket system live here. Controlled by **project
   roles**.

> Talk *inside* your department → Department world.
> Talk *across* departments → an RFI inside the Projects world.

---

## 2. The three access doors (recap + the fix)

| Door | Who uses it | Controls | Rule |
|------|-------------|----------|------|
| **Office Access** | HR / Admin | Back-office screens only: HR, Finance, Dashboard, Activity Log, Access Control | **Back-office job titles only. Never touches projects or department roles.** (This is the fix.) |
| **Team Access** | A department lead | What each teammate can do *inside their own department* | Per-person tick boxes. One department only. Never sees projects or other departments. |
| **Project Access** | Whoever runs a project | What each person can do *on one project* | Add a person to a team on the project, give them a project role. |

**The bug you hit** came from these doors not being truly separate yet: the Office
Access screen could see and try to delete a *project* role, and the database
stopped it because a real person was using that role on a real project. Once the
doors are separated (below), that can't happen — Office Access will only ever show
back-office titles.

---

## 3. Two kinds of roles (this is the heart of the fix)

- **Back-office job titles** — Administrator, Accountant, HR Manager… One per
  employee. Managed in **Office Access**. Only open back-office screens.

- **Project roles** — Project Lead, Designer, Junior, Vendor… Used on projects.
  **Grouped by department** (Design has its own set, Site has its own, etc.), so a
  "Project Lead" on the Design side is a different role from a "Project Lead" on
  the Site side. Each department **owns and edits its own** project roles.

These two kinds never mix. Office Access only manages the first kind.

### Project roles are ranked
Within each department, you **hand-order the project roles top-to-bottom** (top =
most senior). This ladder is used for RFI escalation (Section 6).

---

## 4. The module map (what splits into what)

Today everything design-related is one "Design Department" module that secretly
mixes department work and project work. We split it:

**A. Global Projects module** *(new home for project work)*
- The list of all projects (Design, MEP, Interior… each tagged by department).
- Each project's **two-phase lifecycle** and **per-department pipelines** (Section 5b).
- Each project's **multiple department teams** and their members + project roles.
- **Briefs** (see Section 5).
- **Folders** and project files.
- The **RFI ticket system** (Section 6) and **change-order / variation tracker**.

**B. Department modules** *(one per department: Design, Project Management, MEP,
Interior, Site…)*
- Internal **task board + calendar** (Section 7).
- Project-linked tasks.
- Internal department communication.
- That department's **questionnaire template library** (used to create briefs).
- That department's own **pipeline/stage list** for a project (Design's = the 14
  stages), folder catalogue, and its project-role set.
- Inside **Design**: a **Concept** sub-team and a **Technical** sub-team (Section 8).
- **Project Management** is its own department — it takes control at the Design
  Freeze handoff (Section 5b).

**C. Back-office modules** *(unchanged in spirit)*
- HR, Finance, Dashboard, Activity Log, Access Control. Governed by Office Access.

---

## 5. Briefs

- A brief lives **on the project** (Projects world), built from the relevant
  department's questionnaire template.
- **Who can view/edit a brief is decided by a project-role tick-box** — only roles
  you've ticked (e.g. "Design Concept Lead") can open it. Not everyone on the
  project sees it.
- The brief is filled at the start of the project (stage 1, "Project brief
  received") by the Design Concept team, during the private Concept phase below.

---

## 5b. Project lifecycle — phases, stages & the Design Freeze handoff

This is the backbone everything hangs off.

### A project has two phases
1. **Concept phase (stages 1–8):** owned and controlled by the Design **Concept**
   team. The project is **private** — no other team sees it by default. Concept
   can **invite specific teams in for specific stages** (e.g. MEP gets a limited
   view at stage 5, "MEP initial briefing") while keeping overall control.
2. **Execution phase (stages 9–14):** begins at the **Design Freeze**.

### The Design Freeze = a deliberate handoff
At stage 8 ("Design Freeze"), someone with the right role **clicks a Freeze /
handoff action**. That single, auditable moment:
- transfers control from Design Concept to the **Project Management department**;
- brings in the Design **Technical** team and the other teams (MEP, Site, Vendor);
- opens the project up from "private to Concept" to "visible to the assigned teams".
- locks the design — *"no informal changes after this stage."*

### Each department runs its own pipeline on the project
The **14 stages in the screenshot are the *Design* department's pipeline** across
the whole project (brief → change-order control). Other departments (Project
Management, MEP…) have **their own stage lists** for their part of the same
project. So one project shows several department pipelines, some running in
parallel after the handoff.

### Who works when (Design side)
- **Concept team:** stages **1–8** (Brief → Design Freeze). Exclusive control.
- **Technical team:** from stage **8/9** onward (GFC drawings, MEP coordination,
  GFC issue, DTM, site support, change orders). Works **in parallel** with the
  Project Management team and Concept, monitors progress, and **handles the RFIs,
  requirements and change orders.**

---

## 6. The RFI (Request for Information) system

- An RFI is raised **inside a specific project**, sent **from one department team
  to another** (e.g. Site asks Design a question on Project X).
- It behaves like a **ticket**: raised → answered → can be **escalated**.
- **Escalation climbs the seniority ladder** of the **target department** (the one
  being asked), one rank at a time, using the role order from Section 3.
- Escalation stays **within that one department** — it never jumps sideways into
  another department.

---

## 7. Department task management

Each department module gets:
- A **task board** — assign a task to a teammate, set status, track to done.
- A **calendar** — shows who is assigned what, and for how many days (start/end).
- **Project-linked tasks** — a department task can point back to a project, so
  internal work ties to project work.

---

## 8. The Concept ↔ Technical rule (Design only, for now)

Concept and Technical are **two sub-teams inside Design** — a soft separation, not
a hard wall. Their handoff point on a project is the **Design Freeze** (stage 8):
Concept runs stages 1–8, Technical runs 9–14 (Section 5b).

- **What's hidden:** each sub-team's **tasks/tickets are private**. Shared project
  info (the brief they're allowed to see, basic status) stays visible to both.
- **Direction:** **both ways** — Concept can't see Technical's tasks, and Technical
  can't see Concept's tasks, by default.
- **This applies everywhere a task shows** — both on the internal board and when a
  task is linked to a project.
- **Crossing the line is allowed three ways**, and the system supports all three:
  1. A person is a **member of both** sub-teams (sees both).
  2. A person is **invited into a specific item** in the other sub-team.
  3. A **senior** role can see across (seniority override).
- Seeing across stays **within Design** — it never reveals another department.

---

## 9. Why this fixes your original problem

- Office Access stops listing project roles → you can never accidentally delete
  one → **the foreign-key error disappears.**
- Project roles are deleted from the Projects world, which already warns you nicely
  ("this role is assigned to members, reassign first") instead of crashing.
- The two matrices stop reaching into each other: the "sees all projects" switch
  moves out of Team Access and into the Projects world where it belongs.

---

## 10. Small things still to confirm

The big picture is complete. These are minor and I can propose defaults:
- **Who can trigger the Design Freeze** — likely a senior Design Concept role.
- **How Concept "invites a team in for a stage"** before freeze — a per-stage,
  per-team view grant (e.g. MEP at stage 5).
- **Project Management's own stage list** (their pipeline) — to be defined like
  Design's 14 stages.
- **Change-order / variation tracker** (stage 14) details.

---

## 11. Build order (safest first — for later, after you approve)

1. **Separate the roles** (back-office vs project) and make Office Access show only
   back-office titles. *(Fixes your bug.)*
2. **Carve out the Projects module** from today's Design module (projects, teams,
   briefs, folders, the all-projects switch).
3. **Add the project lifecycle** — Concept/Execution phases + the Design Freeze
   handoff + per-department pipelines.
4. **Slim the Department modules** to internal work (task board + calendar,
   templates, settings) and add the Concept/Technical separation.
5. **Add the RFI system** + change-order tracker to the Projects world.
6. **Department task board + calendar.**
7. **Project Management department** and remaining departments (MEP, Interior…).

Each step is small and reviewed before the next.
