import { describe, expect, it } from "vitest";

import { moduleResources } from "@/core/modules/registry";
import { stageRules, type ApprovalStageRow } from "@/modules/access/approval-engine";
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
    expect(APPROVAL_FLOWS.filter((f) => f.engineId).map((f) => f.engineId)).toEqual([
      "pettycash",
      "change_order",
    ]);
  });
});

describe("stageRules", () => {
  const base: ApprovalStageRow = {
    id: "s1",
    flow_id: "pettycash",
    position: 1,
    label: "Senior approval",
    approver: "senior",
    resource: "pettycash.senior",
    action: "approve",
    job_title_id: null,
    skip_job_title_ids: ["md", "cf"],
    min_amount: 2000,
    block_own: true,
  };
  const titles: Record<string, string> = { md: "Managing Director", cf: "Co-Founder" };

  it("spells out seniority, skips, the amount and the own-item rule", () => {
    const rules = stageRules(base, (id) => titles[id]);
    expect(rules.join(" ")).toMatch(/above the requester/);
    expect(rules.join(" ")).toMatch(/Skipped for: Managing Director, Co-Founder/);
    expect(rules.join(" ")).toMatch(/₹2,000 or more/);
    expect(rules.join(" ")).toMatch(/can't approve their own/);
  });

  it("says plainly when a job-title stage lost its job title", () => {
    const rules = stageRules(
      { ...base, approver: "job_title", job_title_id: null, skip_job_title_ids: [], min_amount: null, block_own: false },
      (id) => titles[id]
    );
    expect(rules).toEqual(["Its job title was deleted — only administrators can approve it now."]);
  });
});
