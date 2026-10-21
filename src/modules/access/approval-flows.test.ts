import { describe, expect, it } from "vitest";

import { moduleResources } from "@/core/modules/registry";
import {
  stageNeedsRole,
  stageRules,
  type ApprovalStageRow,
  type RoleOption,
} from "@/modules/access/approval-engine";
import { APPROVAL_FLOWS } from "@/modules/access/approval-flows";

describe("APPROVAL_FLOWS", () => {
  const byId = new Map(moduleResources().map((r) => [r.id, r]));

  it("points every step at a real resource and one of its verbs", () => {
    // If a module renames a resource or drops a verb, the Approval flows page
    // would quietly show the wrong people — fail here instead.
    for (const flow of APPROVAL_FLOWS) {
      for (const step of flow.steps) {
        if (!step.resource) {
          expect(step.action, `${flow.id}: ${step.label}`).toBeUndefined();
          continue;
        }
        const r = byId.get(step.resource);
        expect(r, `${flow.id}: ${step.label} → ${step.resource}`).toBeDefined();
        expect(r!.actions, `${flow.id}: ${step.label}`).toContain(step.action);
      }
    }
  });

  it("names a real module on every flow whose items sit on a project", () => {
    // The module decides which departments' project roles a stage may name, so
    // a typo here would quietly offer the wrong department's roles.
    const offProject = new Set(["pettycash", "vendor"]);
    for (const f of APPROVAL_FLOWS) {
      if (!f.engineId || offProject.has(f.engineId)) continue;
      expect(f.module, f.id).toBeDefined();
      expect(byId.get(f.module!), `${f.id} → ${f.module}`).toBeDefined();
    }
  });

  it("gives every flow a unique id and at least two steps", () => {
    const ids = APPROVAL_FLOWS.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const f of APPROVAL_FLOWS) expect(f.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("marks exactly where an editable flow's stages go, and only there", () => {
    for (const f of APPROVAL_FLOWS) {
      const placeholders = f.steps.filter((s) => s.stages).length;
      expect(placeholders, f.id).toBe(f.engineId ? 1 : 0);
    }
    expect(new Set(APPROVAL_FLOWS.filter((f) => f.engineId).map((f) => f.engineId))).toEqual(
      new Set([
        "pettycash",
        "change_order",
        "intent",
        "vendor",
        "brief",
        "brief_revision",
        "invoice",
        "payment",
        "advance",
        "retention_early",
        "order",
        "budget",
      ])
    );
  });
});

describe("stageRules", () => {
  const base: ApprovalStageRow = {
    id: "s1",
    flow_id: "pettycash",
    position: 1,
    label: "Senior approval",
    approver: "role",
    role_id: "md",
    skip_job_title_ids: ["md", "cf"],
    min_amount: 2000,
    block_own: true,
  };
  const titles: Record<string, string> = { md: "Managing Director", cf: "Co-Founder" };
  const roles: Record<string, RoleOption> = {
    md: { id: "md", label: "Managing Director", department: null, departmentId: null },
    pd: { id: "pd", label: "Project Director", department: "Project Management", departmentId: "d1" },
  };
  const rulesFor = (s: ApprovalStageRow) =>
    stageRules(s, (id) => roles[id] ?? null, (id) => titles[id]).join(" ");

  it("names the one role, the skips, the amount and the own-item rule", () => {
    const rules = rulesFor(base);
    expect(rules).toMatch(/Only Managing Director can give it/);
    expect(rules).toMatch(/Skipped for: Managing Director, Co-Founder/);
    expect(rules).toMatch(/₹2,000 or more/);
    expect(rules).toMatch(/can't approve their own/);
    expect(rules).toMatch(/can't give this one/);
  });

  it("ties a project role to its department and the item's project", () => {
    expect(rulesFor({ ...base, role_id: "pd" })).toMatch(
      /Only Project Management's Project Director, on the project the item belongs to/
    );
  });

  it("says plainly when a stage has no usable role", () => {
    expect(rulesFor({ ...base, role_id: null })).toMatch(/No approving role chosen yet/);
    expect(rulesFor({ ...base, role_id: "gone" })).toMatch(/Its role was deleted/);
    expect(stageNeedsRole({ ...base, role_id: null })).toBe(true);
    expect(stageNeedsRole(base)).toBe(false);
  });

  it("leaves a department-lead stage to the lead alone", () => {
    expect(rulesFor({ ...base, approver: "dept_lead", role_id: null })).toMatch(
      /Only a lead of the requester's department/
    );
  });
});
