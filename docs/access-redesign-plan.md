# Access Control — The Simple Picture-Plan

A plain-English walkthrough of the three "doors" and what each screen looks like.
No technical words. Approve the look and feel here before any building starts.

---

## The big idea: three separate doors

Access in the company is split into three independent doors. Each is simple on
its own, and none can interfere with the others.

1. **Office door** — HR decides which back-office screens an employee can open.
2. **Department door** — a team lead ticks, person by person, what each can do.
3. **Project door** — inside a project, each person is given a project role.

---

## Door 1 — Office Access (HR's screen)

**Who uses it:** HR.
**What it controls:** the back-office screens — HR, Finance, Dashboard, Activity
Log, and Access Control itself. Nothing about projects.

**How it works:** HR makes *job titles* (a title is a ready-made bundle of
screens). Each employee gets one title. Change the title once, everyone with it
updates.

```
┌─ Office Access ───────────────────────────────────────────────┐
│                                                               │
│  Job titles                          [ + New title ]          │
│  ┌───────────────┬──────────────────────────────────────────┐ │
│  │ Administrator │  Can open:  ☑ Everything                  │ │
│  │ Accountant    │             ☑ Finance   ☑ Dashboard       │ │
│  │ HR Manager    │             ☑ HR        ☑ Dashboard       │ │
│  │ Front Desk    │             ☑ Dashboard                   │ │
│  └───────────────┴──────────────────────────────────────────┘ │
│                                                               │
│  People                                                       │
│  ┌──────────────────────┬──────────────────────────────────┐ │
│  │ Sanjay   sanjay@…     │  Title: [ Administrator  ▼ ]      │ │
│  │ Priya    priya@…      │  Title: [ Accountant     ▼ ]      │ │
│  │ Rahul    rahul@…      │  Title: [ Front Desk     ▼ ]      │ │
│  └──────────────────────┴──────────────────────────────────┘ │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**HR can:** make/rename titles, tick which screens a title opens, give each
person a title, invite new people.
**HR cannot, from here:** touch any project. (That's a different door.)

---

## Door 2 — Team Access (a team lead's screen)

**Who uses it:** the lead of a department (e.g. Design).
**What it controls:** what each teammate can do *within that department's work*.

**How it works:** exactly what you asked for — **person by person, tick boxes.**
No titles, no setup. A grid of people down the side, actions across the top.

```
┌─ Team Access · Design Department ─────────────────────────────────────┐
│                                                                       │
│                    View   Create  Edit   Review  Approve   Manage     │
│  ┌──────────────┬───────┬───────┬───────┬───────┬────────┬────────┐   │
│  │ Sanjay       │  ☑    │  ☑    │  ☑    │  ☑    │   ☑    │   ☑    │   │
│  │ Priya        │  ☑    │  ☑    │  ☑    │  ☐    │   ☐    │   ☐    │   │
│  │ Rahul        │  ☑    │  ☐    │  ☐    │  ☐    │   ☐    │   ☐    │   │
│  └──────────────┴───────┴───────┴───────┴───────┴────────┴────────┘   │
│                                                                       │
│  Per-person switches:                                                 │
│  ┌──────────────┬───────────────────────────┬───────────────────┐    │
│  │ Sanjay       │ Sees ALL projects:  ☑      │ Manage members: ☑ │    │
│  │ Priya        │ Sees ALL projects:  ☐      │ Manage members: ☐ │    │
│  │ Rahul        │ Sees ALL projects:  ☐      │ Manage members: ☐ │    │
│  └──────────────┴───────────────────────────┴───────────────────┘    │
│                                                                       │
└───────────────────────────────────────────────────────────────────────┘
```

**The lead can:** tick what each person can do, switch on "sees all projects" for
seniors, and let someone manage who's on projects.
**The lead cannot:** see or change any other department, or the Office door.

---

## Door 3 — Project Access (inside each project)

**Who uses it:** whoever runs the project (anyone with "manage members").
**What it controls:** what each person can touch *on that one project*.

**How it works:** add a person and pick their **project role**. The role decides
what they can do — but only here, on this project.

```
┌─ Project: Hilltop Residence · Team ───────────────────────────┐
│                                                               │
│  Members                              [ + Add member ]        │
│  ┌──────────────┬──────────────────────────────────────────┐ │
│  │ Sanjay       │  Role: [ Project Lead  ▼ ]                │ │
│  │ Priya        │  Role: [ Designer      ▼ ]                │ │
│  │ Rahul        │  Role: [ Junior        ▼ ]                │ │
│  │ (vendor) Om  │  Role: [ Vendor        ▼ ]                │ │
│  └──────────────┴──────────────────────────────────────────┘ │
│                                                               │
│  A role here = a ready bundle of what they can do on THIS     │
│  project. Same person can be a Lead here and a Designer on    │
│  another project.                                             │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

**Roles available:** Project Lead, Designer, Junior, Site/MEP/QS, Vendor (we can
rename or add any).
**Remove a person from the project → they instantly lose access to it.**

---

## Why this is good for you

- **Simple:** each screen does one job and reads in plain language.
- **Safe:** the three doors can't break each other.
- **Tidy to grow:** when a new department or module is added later, it just
  shows up behind the right door — no rebuild.

---

## What happens next (you approve, I build)

I build it in three small steps, safest first. You only look at each finished
screen and say "yes" or "tweak this."

1. **Office door** (HR titles) — smallest, lowest risk.
2. **Department door** (the per-person checklist).
3. **Project door** (tidy up what already exists).

Nothing technical for you to do. Just approval at each step.
