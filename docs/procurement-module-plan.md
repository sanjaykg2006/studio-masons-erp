# Procurement Module — Plan (v2)

Planning artifact for the Procurement module. Captures the agreed scope, roles,
data model, workflow, and enforcement. **Nothing is built from this yet.** Companion
specs: [budget-boq-format.docx](./budget-boq-format.docx),
[comparison-boq-format.md](./comparison-boq-format.md),
[architecture-decisions.md](./architecture-decisions.md).

Design goals you set: **simple, modular, RBAC-gated end to end, separate logs.**

**What changed in v2 (2026-07-02).** The Projects world Procurement was waiting on
now exists in the live database, so the old blocker is gone. Locked decisions:
- **Sequencing (§11): RESOLVED — build now** as its own department module on the
  existing Projects spine. No rework; the constructs it needs are already live.
- **Split award → PO (§12): one PO per vendor.**
- **Cross-project powers: company-wide roles** (Director / Finance / Senior hold
  grants that reach every project's procurement).

---

## 0. What's already live — Procurement's link points

Everything below **exists today** and is what Procurement bolts onto. This is the
"quickly link it" answer: we're not building a foundation, we're plugging in.

| Procurement needs… | Already live | Where |
|---|---|---|
| A company-wide project to buy for | `projects` table (each tagged `department_id`) + `project_members`, `project_briefs`, `project_files` | [0018_projects_module.sql](../supabase/migrations/0018_projects_module.sql) |
| The project-aware permission gate | `has_project_permission(project, resource, action)` — company-wide grant **or** per-project role **or** all-projects senior | [0031_rbac_hardening.sql:126](../supabase/migrations/0031_rbac_hardening.sql#L126) |
| The global gate (vendor library) | `has_permission(resource, action)` | [0002_rbac.sql](../supabase/migrations/0002_rbac.sql) |
| A "Project Manager" who raises intents | PM department + `pm_project_manager` role, seeded | [0026_project_management_dept.sql](../supabase/migrations/0026_project_management_dept.sql) |
| Department + module registration | `departments`, `department_modules`, `module_settings` + the `role_permissions` guard trigger | 0006 / 0031 |
| Ranked roles (who is senior) | `roles.rank` + reorder UI on department Settings | [0024_role_seniority.sql](../supabase/migrations/0024_role_seniority.sql) |
| File uploads (BOQ workbooks, POs, letters) | private Storage bucket + metadata row + short-lived signed links | pattern in [0030_task_times_and_docs.sql](../supabase/migrations/0030_task_times_and_docs.sql) / `0034_rfi_attachments.sql` |
| Central activity log | audit store, tag `module = procurement` | `src/modules/audit/` |

> **Not-yet-carved (doesn't block us):** the Projects *code* still lives largely
> under `src/modules/design/` — only `src/modules/projects/{index,types}.ts` are
> split out so far. The **database** spine (tables + `has_project_permission`) is
> fully in place, and that's all Procurement links to. Procurement gets its own
> `src/modules/procurement/` regardless.

---

## 1. Placement

Procurement is **its own department module** (like Design), registered as a
department with its own roles and internal work. It *reaches into projects* to buy
for them, so its project-tied data is gated by the **project-aware** permission
layer (`has_project_permission`), while its shared library (the vendor directory)
is gated globally (`has_permission`) — the same two-tier split the Design module
uses for briefs vs templates.

It has **two touchpoints** with the Global Projects world:
- The **Project Manager** (a per-project role in Projects — the seeded
  `pm_project_manager`) raises purchase intents.
- The Global Projects view shows each project's **approved vendor list**.

> ✅ **Dependency resolved (was §11).** The Global Projects world Procurement leans
> on is live: the `projects` table (tagged by department), per-project roles, and
> `has_project_permission`. See §0 for the exact link points. We build now.

---

## 2. Roles & RBAC mapping

| Role | Kind (RBAC) | In procurement they… |
|---|---|---|
| **Topmost senior** (MD) | Global, wildcard (`*`) grant | Approve **over-budget PO amendments** (the amendment-stage bypass). Inherits all. |
| **Project Director** | **Company-wide** grant (held globally, resolved by `has_permission` inside `has_project_permission`) — reaches every project's procurement | Approve intents; clear the **intent-stage** qty bypass; **award vendors**; approve Budget BOQ re-versions; approve amendments (with Finance). |
| **Finance** | Company-wide grant | Verify vendor **legitimacy** (global approval); verify the **chosen vendor** per purchase; co-approve amendments. (Full Finance *module* is later.) |
| **Project Manager** | **Per-project** role (the seeded `pm_project_manager`, or any dept's PM-equivalent) | Raise purchase intents on their project. |
| **Procurement Manager** | Procurement dept **lead** role | Prepare/import comparison BOQ; record & release POs; record receipts. |
| **Procurement team member** | Procurement dept role | Prep work: import Budget BOQ, data entry, uploads. |

### Permission resources (sub-resources of the `procurement` module)

Each is its own matrix row and RLS boundary. Verbs drawn from the existing 8-verb
vocabulary (`read/create/update/review/approve/issue/delete/manage`).

| Resource | Scope | Verbs (who) |
|---|---|---|
| `procurement.vendor` | Global library | read · create/update (Proc team) · **approve** = mark legitimate (Finance) · delete |
| `procurement.budget` | Per-project | read · create = import (Proc team) · update = edit lines · **approve** = re-version sign-off (Director) · delete |
| `procurement.intent` | Per-project | read · create (Project Manager) · **approve** + bypass (Director) · delete |
| `procurement.comparison` | Per-project | read · create = prepare/import (Proc Mgr) · **approve** = award vendor (Director) |
| `procurement.order` | Per-project | read · **issue** = release PO (Proc Mgr) · update = amend · **review** = Finance sign-off · **approve** = Director/senior sign-off |
| `procurement.receipt` | Per-project | read · create/update = record receipt (Proc team) |

> Multi-party sign-offs (Director **and** Finance on an amendment) are modeled as
> **separate boolean gates on the record**, each set via that party's own verb, and
> the status only advances when all required gates are green. The over-budget
> amendment escalation routes to whoever holds the **senior bypass** grant (the
> topmost role), distinct from the Director's normal `approve`.

### 2a. Full verb-to-role grant matrix

The exact `role_permissions` grants per role. `✓` = granted. **MD** holds wildcard
`*` (every verb on every resource) so isn't listed per-cell. Verbs come from the
8-verb vocabulary. **How each role is held:** MD / Director / Finance = **company-wide**
(a global role, or a Team Access grant on the Procurement dept); Project Manager =
**per-project** role; Procurement Manager / team member = held on the **Procurement
department** (global role or Team Access), since the whole module is department work.

| Resource · verb | Director | Finance | Proj Manager | Proc Manager | Proc team |
|---|:--:|:--:|:--:|:--:|:--:|
| `procurement.vendor` · read | ✓ | ✓ | ✓ | ✓ | ✓ |
| `procurement.vendor` · create | | | | ✓ | ✓ |
| `procurement.vendor` · update | | | | ✓ | ✓ |
| `procurement.vendor` · **approve** (mark legitimate) | | ✓ | | | |
| `procurement.vendor` · delete | | | | ✓ | |
| `procurement.budget` · read | ✓ | ✓ | ✓ | ✓ | ✓ |
| `procurement.budget` · create (import) | | | | ✓ | ✓ |
| `procurement.budget` · update (edit lines) | | | | ✓ | ✓ |
| `procurement.budget` · **approve** (re-version) | ✓ | | | | |
| `procurement.budget` · delete | | | | ✓ | |
| `procurement.intent` · read | ✓ | ✓ | ✓ | ✓ | ✓ |
| `procurement.intent` · **create** (raise) | | | ✓ | | |
| `procurement.intent` · **approve** (+ qty bypass) | ✓ | | | | |
| `procurement.intent` · delete | ✓ | | ✓ (own, draft) | | |
| `procurement.comparison` · read | ✓ | ✓ | ✓ | ✓ | ✓ |
| `procurement.comparison` · create (prepare/import) | | | | ✓ | ✓ |
| `procurement.comparison` · **approve** (award vendor) | ✓ | | | | |
| `procurement.order` · read | ✓ | ✓ | ✓ | ✓ | ✓ |
| `procurement.order` · **issue** (release PO) | | | | ✓ | |
| `procurement.order` · update (raise amendment) | | | | ✓ | |
| `procurement.order` · **review** (Finance sign-off) | | ✓ | | | |
| `procurement.order` · **approve** (Director sign-off) | ✓ | | | | |
| `procurement.receipt` · read | ✓ | ✓ | ✓ | ✓ | ✓ |
| `procurement.receipt` · create / update (record) | | | | ✓ | ✓ |

> **Over-budget bypass** isn't a separate verb — it's the **MD's** wildcard clearing
> the over-budget gate on an intent/amendment. Director's `approve` handles the
> normal (within-budget) path; the record just carries an extra `senior_bypass_by`
> gate that only the MD can set.
>
> **Where the grant lives vs. where it applies.** A grant on a per-project resource
> (`budget/intent/comparison/order/receipt`) only reaches a project when the holder
> has it **company-wide** (Director/Finance/MD) **or** through a **project role**
> (Project Manager) **or** a **Team Access** tick on the Procurement department. The
> global `procurement.vendor` library is reached purely through `has_permission`
> (company-wide role or Team Access) — never through project membership.

---

## 3. Data model (tables, `procurement_*`)

**Vendor directory (global)**
- `procurement_vendors` — id, name, **type** (supplier / subcontractor / service),
  trade/category, contact, address, GST, PAN, bank details, **status**
  (draft / approved / rejected), approved_by (Finance), approved_at.
- `procurement_vendor_project_approvals` — (vendor_id, project_id, approved_by,
  approved_at). The **per-project** approval layer.

**Budget BOQ (per project, versioned)**
- `procurement_budgets` — id, project_id, version_no, status (draft / released),
  workbook_file, created_by, approved_by (Director, for re-versions), released_at.
- `procurement_budget_packages` — id, budget_id, name, sort. *(First-class packages.)*
- `procurement_budget_lines` — id, package_id, ref, description, unit, **qty**
  (budgeted), rate, supply_rate, install_rate, amount, sort.

**Purchase intent (per project)**
- `procurement_intents` — id, project_id, package_id (nullable), raised_by (PM),
  status, needed_by, notes, approved_by (Director), approved_at.
- `procurement_intent_lines` — id, intent_id, **budget_line_id** (FK), qty_requested,
  over_budget (bool), bypass_approved_by.

**Comparison (per project)**
- `procurement_comparisons` — id, project_id, package_id (nullable), workbook_file,
  status, prepared_by (Proc Mgr), awarded_by (Director), awarded_at.
- `procurement_comparison_lines` — id, comparison_id, budget_line_id, description,
  unit, qty.
- `procurement_comparison_quotes` — id, comparison_line_id, vendor_id, rate, amount,
  make. *(Blank rate = no quote.)*
- `procurement_comparison_awards` — id, comparison_line_id, vendor_id, qty, rate.
  *(Per-line award; whole-package award = every line to the same vendor.)*

**Purchase order (per project)**
- `procurement_orders` — id, project_id, vendor_id, comparison_id, status
  (draft / released / accepted-live / amended / closed), po_file,
  acceptance_letter_file, released_by, released_at, accepted_at,
  finance_verified_by, finance_verified_at. *(One row per vendor — a split award
  on one comparison yields several orders sharing `comparison_id`, each with its
  own `vendor_id`.)*
- `procurement_order_lines` — id, order_id, budget_line_id, description, unit, qty,
  rate, amount.
- `procurement_order_amendments` — id, order_id, version_no, changes, status,
  requested_by, director_approved_by, finance_approved_by, senior_bypass_by
  (nullable — only when over budget), file. *(Versioned; each version's file kept.)*

**Goods receipt (per project)**
- `procurement_receipts` — id, order_line_id, received_qty, received_date,
  balance_qty (derived), recorded_by, remarks. *(Multiple partial receipts per line
  until balance = 0.)*

**Files** — a `procurement_files` store scoped by project + doc type (budget
workbook, comparison workbook, PO, acceptance letter, amendment), RBAC-gated (PO
folder access is permission-controlled).

---

## 4. Workflow (state machine)

```
BUDGET BOQ
  import workbook → review/reconcile → RELEASED (live qty thresholds)
  re-version: RELEASED → new draft → Director approve → RELEASED (supersedes)

PURCHASE INTENT                     (raised by Project Manager)
  draft → submitted → Director: approve | reject(→ back to PM or close)
  a line whose cumulative ordered qty would exceed its Budget line = HARD BLOCK
    → needs Director intent-stage bypass to proceed

COMPARISON                          (Procurement Manager)
  bundle ≥1 approved intents (per package OR specific) → import comparison workbook
    → review/reconcile → release to Director
  Director AWARDS: whole-package to one vendor, OR split per line
    · awardable vendor must be globally-approved AND project-approved
  ‖ Finance verifies the chosen vendor(s): legitimacy (if new) + per-purchase check

PURCHASE ORDER                      (Procurement Manager)
  Director award + Finance verify both green →
  ONE PO PER AWARDED VENDOR (a split award across N vendors → N separate POs,
    each with its own lines, file, acceptance letter, amendments and receipts)
  record PO v1 (upload PO file) → RELEASED
  vendor acceptance letter uploaded → ACCEPTED / LIVE
  amendments → versioned v1 → v2 → … (see §4b)
  fully received → CLOSED

GOODS RECEIPT
  record partial receipts against PO lines (qty + date) until balance = 0
  received qty CARRIES FORWARD across PO versions
```

**Approved-vendor list (Global Projects):** union of (vendors explicitly approved
for the project) + (vendors that won a comparison on it). Removal is manual. Gated
by RBAC.

---

## 4b. PO amendments (the finalized model)

Once a line has a PO, further changes go through **amendments**, not new POs. This
is the most nuanced part of the module, so it's specified in full. A clickable
model of these exact rules was prototyped at `/procurement-demo` (throwaway).

### Two amendment paths

**Path A — auto, intent-driven (quantity).** Raising a purchase intent for a line
that **already has a PO** does **not** create a new PO and does **not** go back
through comparison — it **auto-routes into a PO amendment request** against the
existing PO, keeping the **same vendor**. (Before a PO exists, a further intent
instead **merges into the in-flight comparison/award** — amendments only begin once
a PO exists.) The extra intent still requires the **Director** (see below). Rate may
stay the same or change; a rate change means **Finance is informed**.

**Path B — manual (terms / rate).** The Procurement team raises an amendment for
terms/rate changes not driven by an intent (vendor and qty unchanged).

### Quantity semantics

- The amendment quantity is an **absolute new total** (e.g. "change 20 → 30"),
  **pre-filled** with `current PO qty + intent qty`, and the **excess over the
  Budget line is flagged**.
- A new version **replaces** the previous one — it does **not** stack. So the
  Budget line's **committed** qty reads the **latest version's** total (30), never
  20 + 30. Amendments may also **decrease** qty.

### Approvals

| Path | Sign-offs (all required) |
|---|---|
| **A · intent-driven, within budget** | **Director** (approves the intent) + **Procurement Manager** (approves the amendment) · Finance *informed* |
| **A · intent-driven, over budget** | **Director** + **Procurement Manager** + **Senior (MD)** (mandatory when over budget) · Finance *informed* |
| **B · manual (terms/rate)** | **Finance** + **Senior (MD)** |

> **The Director is required on *every* intent.** Being over budget does **not** add
> a separate optional step — it just **flags "over budget" during the Director's
> approval**, and additionally makes the **Senior (MD)** sign-off mandatory. Finance
> is *informed* on Path A (vendor already verified in v1), a real approver on Path B.

### Versioning

- The **whole PO versions** `v1 → v2 → v3 …` (all lines snapshotted together), even
  when only one line changed.
- **Only the latest version reflects everywhere** — PO list/detail, goods receipt,
  budget draw-down, approved-vendor list, spend, logs. **Older versions are
  view-only**, reachable via a **version-history** view.
- Each version keeps its **own PO file + acceptance letter**; every new version
  needs a **fresh vendor acceptance letter** before it goes live.
- **Received qty carries forward** across versions (e.g. 5 of 20 received, then v2
  raises the order to 30 → 30 ordered · 5 received · 25 balance).
- The originating **intent stays its own record**, linked to the amendment, for the
  audit trail.

---

## 5. Enforcement (the real boundary = DB)

- Register the **Procurement department** + `department_modules` + `module_settings`
  (the sub-resources are department-specific, not general).
- **RLS on every table.** Global library (vendors) → `has_permission('procurement.vendor', …)`.
  Project-scoped tables → `has_project_permission(project_id, 'procurement.<x>', …)`.
- Project Director / Finance / Senior reach every project via the **company-wide**
  branch of `has_project_permission` (their grant is held globally, so the first
  `has_permission` check passes for any project); Project Manager reaches only
  their own projects via **membership**; Procurement Manager/team act across
  procurement within their verbs. (The per-department "all projects" switch stays
  available if you ever want to scope an approver to one department.)
- Pages: `requirePermission` / `requireProjectPermission`. Server actions:
  `authorize` / `authorizeProject`. UI: `<Can>` / `usePermissions`.

## 6. The two parsers

One shared xlsx **sheet-walking + header-detection core**, two thin column mappers
(Budget BOQ, Comparison BOQ), each with a **review/reconciliation step**. Both in
v1. See the two format specs. The ERP can also **emit a pre-filled comparison
template** from the stored Budget BOQ (removes description-matching warnings).

## 7. Logs

Write to the **existing central audit store**, tagged `module = procurement`, with a
**per-module filtered log view** inside Procurement. Captures every state
transition (intent raised/approved, bypass cleared, vendor awarded, PO
released/accepted/amended, receipt recorded) with **who + when**. No field-level
diffing beyond that.

---

## 8. Cross-module touchpoints

- **Global Projects** surfaces the project's approved-vendor list and hosts the
  Project Manager role that raises intents.
- **Finance** is a role now; the future Finance module will absorb its verification
  steps and take procurement's invoice/payment handoff.

## 9. v1 vs later

- **v1:** vendor directory (2-layer approval), Budget BOQ import, purchase intents
  with qty threshold, comparison import + award (whole/split), PO record + acceptance
  → live, **amendments (§4b): intent-driven auto-amendment + manual, whole-PO
  versioning, carry-forward receipts**, goods receipt (partial), per-module logs,
  RBAC/RLS throughout.
- **v2+:** auto-generate the PO document; invoice/payment (Finance module).
- **Explicitly out:** any external/vendor login. Vendors are pure data.

## 10. Build footprint

- Migrations (modular, sequenced), RLS in each:
  1. **department + global vendor directory** ✅ *BUILT (`0036` + `src/modules/procurement/`).*
     Registers the Procurement department, the `procurement.vendor` resource, the
     `procurement_vendors` table + RLS, and the two seed roles (Procurement Manager,
     team member). Purely global — no project dependency, lowest risk.
  2. **budget BOQ (per-project, versioned)** ✅ *BUILT (`0037` + `/projects/[id]/budget`).*
     `procurement_budgets` / `_packages` / `_lines`, project-scoped RLS, a released-version
     lock, and the start/release/re-version lifecycle. Manual entry; **Excel import is a
     follow-up.**
  3. **purchase intents (per-project)** ✅ *BUILT (`0038` + `/projects/[id]/intents`).*
     `procurement_intents` / `_lines`, resource registered to Procurement + PM depts,
     RFI-style RPCs (raise/approve/reject/withdraw), over-budget flagging vs cumulative
     approved qty, Director approval clears the intent-stage bypass.
  4. comparison (also adds `procurement_vendor_project_approvals` — the per-project
     approved-vendor list is mostly populated by comparison winners, so it rides here)
     → 5. orders/amendments/receipts → 6. files.
- `src/modules/procurement/` — `index.ts`, `types.ts`, `data.ts`, `actions.ts`,
  `parsers/`, `components/`. Route `app/(app)/procurement/`. One registry line.
- Reuse Design patterns: versioning, lock-on-finalise (issued PO read-only),
  SECURITY DEFINER read-helpers for names without global `access:read`.

## 11. Sequencing — RESOLVED (build now)

The old blocker was that Procurement needed Projects-world constructs that didn't
exist. **They exist now** (see §0): the company-wide `projects` table, per-project
roles including the seeded **Project Manager**, and `has_project_permission` (whose
company-wide branch gives the **Project Director** every-project reach). The old
Option A ("do the re-arch first") is effectively **done** at the database level.

**Decision: build Procurement now as its own department module on that spine.** No
rework — it links to real tables, not `design_projects`. Register the Procurement
department + its sub-resources, then build the migrations in the §10 order. The
Projects *code* carve-out (`src/modules/projects/`) can continue independently and
does not gate this.

## 12. Still open

- **~~Split award → PO structure~~ — DECIDED: one PO per vendor** (§4, §3
  `procurement_orders`). A split award on one comparison creates several POs
  sharing `comparison_id`, each with its own vendor, file, acceptance letter,
  amendments and receipts.
- Exact verb-to-role grants per resource (the full matrix), building on §2.
- Whether the topmost-senior (MD) role has any procurement duties beyond the
  over-budget amendment bypass.
- Currency / rounding / number formatting conventions (assume INR, ex-GST lines).

## 13. Prototype (throwaway)

A client-only prototype validating the workflow, RBAC gating, and the §4b amendment
model runs at `/procurement-demo` (`src/app/procurement-demo/`). **Not part of the
ERP** — no registry entry, no auth, no DB; delete the folder when done. It is a
clickable spec of the rules, not the implementation: the real build re-implements
these on the server/DB (RLS, persistence, real Excel imports, file uploads) against
the **now-live** projects spine (§0). See it for the exact
intent→amendment→version behaviour.
