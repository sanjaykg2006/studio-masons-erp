// Fill the test ERP with fake people and fake work — never run against live.
//
// One login per kind of person (all sharing TEST_USER_PASSWORD), placed the
// way people are on live: job titles, department teams, "sees all projects"
// roles, department leads, project members. Then two demo projects with
// budgets, vendors, intents and POs at different stages, so every approval
// step has something waiting. Every row has a fixed id, so running it again
// refreshes the demo instead of duplicating it.
//
// Run `npm run test-env:copy-setup` first (the roles and departments named
// here come from the live setup).
//
// Usage:  npm run test-env:seed
// Needs in .env.local: TEST_SUPABASE_URL, TEST_SUPABASE_SERVICE_ROLE_KEY,
//                      TEST_USER_PASSWORD, and NEXT_PUBLIC_SUPABASE_URL (to
//                      make sure the target is not live).

import { createHash } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env.local`);
  return v;
};
const testUrl = need("TEST_SUPABASE_URL");
if (new URL(need("NEXT_PUBLIC_SUPABASE_URL")).host === new URL(testUrl).host) {
  throw new Error("TEST_SUPABASE_URL points at the live project — refusing to seed it.");
}
const password = need("TEST_USER_PASSWORD");
const db = createClient(testUrl, need("TEST_SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const check = (what, { data, error }) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};
const upsert = async (table, rows, onConflict = "id") =>
  check(`Writing ${table}`, await db.from(table).upsert(rows, { onConflict }));

// Fixed ids: `id("project-a")` is the same uuid on every run.
const id = (name) => {
  const h = createHash("sha256").update(`studio-masons-test:${name}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

// ── Lookups from the copied setup ───────────────────────────────────────────
const roles = check("Reading roles", await db.from("roles").select("id, label, department_id"));
const depts = check("Reading departments", await db.from("departments").select("id, key"));
const dept = (key) => {
  const d = depts.find((x) => x.key === key);
  if (!d) throw new Error(`No "${key}" department — run npm run test-env:copy-setup first`);
  return d.id;
};
const role = (label, deptKey = null) => {
  const r = roles.find(
    (x) => x.label === label && (deptKey ? x.department_id === dept(deptKey) : x.department_id === null)
  );
  if (!r) throw new Error(`No role "${label}"${deptKey ? ` in ${deptKey}` : ""} — run test-env:copy-setup`);
  return r.id;
};

// ── People ──────────────────────────────────────────────────────────────────
// key, name, job title, [department, all-projects role], lead of
const PEOPLE = [
  ["admin", "Test Admin", "Administrator"],
  ["md", "Test MD", "Managing Director"],
  ["director", "Test Director", "Director", ["project_management", "Project Director"], "project_management"],
  ["cofounder", "Test Co-Founder", "Co-Founder"],
  ["financehead", "Test Finance Head", "Staff", ["finance", "Finance Head"], "finance"],
  ["accountshead", "Test Accounts Head", "Staff", ["finance", "Accounts Head"]],
  ["accounts", "Test Accounts", "Staff", ["finance", "Accounts Team"]],
  ["buyer", "Test Procurement Manager", "Staff", ["procurement", "Procurement Manager"], "procurement"],
  ["pm", "Test Project Manager", "Staff", ["project_management", null]],
  ["site", "Test Site Engineer", "Staff", ["project_management", null]],
  ["designer", "Test Designer", "Staff", ["design", "Designer"], "design"],
  ["staff", "Test Staff", "Staff"],
];
const email = (key) => `${key}@example.com`;

const existing = check("Listing users", await db.auth.admin.listUsers({ perPage: 200 })).users;
const uid = {};
for (const [key, name] of PEOPLE) {
  const found = existing.find((u) => u.email === email(key));
  if (found) {
    check(`Updating ${key}`, await db.auth.admin.updateUserById(found.id, { password, email_confirm: true }));
    uid[key] = found.id;
  } else {
    const created = check(
      `Creating ${key}`,
      await db.auth.admin.createUser({ email: email(key), password, email_confirm: true, user_metadata: { full_name: name } })
    );
    uid[key] = created.user.id;
  }
}

await upsert(
  "profiles",
  PEOPLE.map(([key, name, title]) => ({ id: uid[key], email: email(key), full_name: name, role_id: role(title) }))
);
await upsert(
  "team_members",
  PEOPLE.filter((p) => p[3]).map(([key, , , [d, r]]) => ({
    department_id: dept(d),
    user_id: uid[key],
    all_projects: !!r,
    all_projects_role_id: r ? role(r, d) : null,
  })),
  "department_id,user_id"
);
await upsert(
  "department_leads",
  PEOPLE.filter((p) => p[4]).map(([key, , , , lead]) => ({ department_id: dept(lead), user_id: uid[key] })),
  "department_id,user_id"
);

// ── Projects ────────────────────────────────────────────────────────────────
const pmDept = dept("project_management");
const A = id("project-a");
const B = id("project-b");
await upsert("projects", [
  { id: A, code: "DEMO-A", name: "Green Meadows Villa", client: "Mr. R. Krishnan", location: "Whitefield, Bengaluru",
    department_id: pmDept, phase: "execution", status: "brief_approved" },
  { id: B, code: "DEMO-B", name: "Lakeside Office Fit-out", client: "Lakeside Tech Pvt Ltd", location: "Bellandur, Bengaluru",
    department_id: pmDept, phase: "execution", status: "brief_approved" },
]);
await upsert(
  "project_members",
  [
    { project_id: A, user_id: uid.pm, role_id: role("Project Manager", "project_management") },
    { project_id: B, user_id: uid.pm, role_id: role("Project Manager", "project_management") },
    { project_id: A, user_id: uid.site, role_id: role("SITE ENGINEER", "project_management") },
  ],
  "project_id,user_id"
);

// ── Vendors ─────────────────────────────────────────────────────────────────
const vendor = (key, name, type, trade, active = true) => ({
  id: id(`vendor-${key}`), name, type, trade, status: "approved", active,
  contact_name: "Sales desk", contact_phone: "+91 90000 00000", gst: "29ABCDE1234F1Z5",
});
await upsert("procurement_vendors", [
  vendor("balaji", "Sri Balaji Cement Traders", "supplier", "Cement & aggregates"),
  vendor("kaveri", "Kaveri Steel & Hardware", "supplier", "Steel"),
  vendor("nirmal", "Nirmal Electricals", "subcontractor", "Electrical"),
  vendor("oldtimer", "Old Timer Supplies", "supplier", "General", false),
]);

// ── Budgets (released v1 on each project) ───────────────────────────────────
const LINES = {
  A: {
    Civil: [["cement", "OPC 53 grade cement", "bag", 500, 380], ["sand", "River sand", "cum", 40, 2200],
            ["steel", "TMT steel 12 mm", "MT", 8, 64000]],
    Electrical: [["wire", "Copper wire 2.5 sq mm", "coil", 60, 1850], ["mcb", "MCB 32A double pole", "nos", 40, 420]],
  },
  B: {
    Civil: [["cement", "OPC 53 grade cement", "bag", 300, 380]],
    Interiors: [["gypsum", "Gypsum board 12.5 mm", "sheet", 200, 650]],
  },
};
const line = (p, key) => id(`line-${p}-${key}`);
for (const [p, project] of [["A", A], ["B", B]]) {
  await upsert("procurement_budgets", [{ id: id(`budget-${p}`), project_id: project, version_no: 1, status: "released",
    released_at: new Date().toISOString() }]);
  let ps = 0;
  for (const [pkg, items] of Object.entries(LINES[p])) {
    await upsert("procurement_budget_packages", [{ id: id(`pkg-${p}-${pkg}`), budget_id: id(`budget-${p}`), name: pkg, sort: ps++ }]);
    await upsert("procurement_budget_lines", items.map(([key, description, unit, qty, rate], sort) => ({
      id: line(p, key), package_id: id(`pkg-${p}-${pkg}`), description, unit, qty, rate, sort })));
  }
}

// ── Intents ─────────────────────────────────────────────────────────────────
await upsert("procurement_intents", [
  { id: id("intent-a1"), project_id: A, status: "approved", raised_by: uid.pm, notes: "Slab casting, block A",
    approved_by: uid.director, approved_at: new Date().toISOString() },
  { id: id("intent-b1"), project_id: B, status: "pending", raised_by: uid.pm, notes: "Partition walls, level 2" },
]);
await upsert("procurement_intent_lines", [
  { id: id("il-a1-cement"), intent_id: id("intent-a1"), budget_line_id: line("A", "cement"), qty_requested: 200, location: "Block A" },
  { id: id("il-a1-steel"), intent_id: id("intent-a1"), budget_line_id: line("A", "steel"), qty_requested: 3, location: "Block A" },
  { id: id("il-b1-gypsum"), intent_id: id("intent-b1"), budget_line_id: line("B", "gypsum"), qty_requested: 120, location: "Level 2" },
]);

// ── Purchase orders ─────────────────────────────────────────────────────────
// PO-001 is live with part of the cement delivered; PO-002 waits for approval.
await upsert("procurement_orders", [
  { id: id("po-a1"), project_id: A, intent_id: id("intent-a1"), vendor_id: id("vendor-balaji"), po_number: "PO-001",
    status: "issued", support_file: "demo/quote.pdf", acceptance_file: "demo/acceptance.pdf",
    issued_by: uid.buyer, issued_at: new Date().toISOString() },
  { id: id("po-a2"), project_id: A, intent_id: id("intent-a1"), vendor_id: id("vendor-kaveri"), po_number: "PO-002",
    status: "draft", support_file: "demo/quote.pdf" },
]);
await upsert("procurement_order_lines", [
  { id: id("ol-a1-cement"), order_id: id("po-a1"), budget_line_id: line("A", "cement"), intent_line_id: id("il-a1-cement"),
    description: "OPC 53 grade cement", unit: "bag", location: "Block A", qty_ordered: 200, rate: 370, budget_rate: 380, sort: 0 },
  { id: id("ol-a2-steel"), order_id: id("po-a2"), budget_line_id: line("A", "steel"), intent_line_id: id("il-a1-steel"),
    description: "TMT steel 12 mm", unit: "MT", location: "Block A", qty_ordered: 3, rate: 62500, budget_rate: 64000, sort: 0 },
]);
await upsert("procurement_receipts", [{ id: id("receipt-a1"), order_id: id("po-a1"), received_on: new Date().toISOString().slice(0, 10),
  notes: "First truck (seeded demo — no GRN file attached)", recorded_by: uid.buyer }]);
await upsert("procurement_receipt_lines", [{ id: id("rl-a1"), receipt_id: id("receipt-a1"), order_line_id: id("ol-a1-cement"), qty_received: 80 }]);

// Inserting fires the "send for approval" triggers, so the items seeded as
// already approved (vendors, intent A1) got a pending request too; close those.
// PO-002 and intent B1 are left waiting on purpose.
check(
  "Closing seeded approvals",
  await db
    .from("approval_requests")
    .update({ status: "approved" })
    .in("item_id", [id("vendor-balaji"), id("vendor-kaveri"), id("vendor-nirmal"), id("vendor-oldtimer"), id("intent-a1")])
);

console.log(`✓ Test ERP seeded: ${PEOPLE.length} logins (…@example.com), 2 projects, 4 vendors, 2 budgets, 2 intents, 2 POs.`);
console.log("  Logins:", PEOPLE.map(([k]) => email(k)).join(", "));
