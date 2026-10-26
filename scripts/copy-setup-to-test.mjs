// Copy the live ERP's SETUP into the test ERP — never its people or business data.
//
// "Setup" = departments, job titles / project roles and their ticks, which
// modules live where, approval flows and stages, folder access, petty-cash
// categories, project step templates, design brief templates and billing
// branches. Run it whenever the live setup changes, so the test ERP behaves
// like live. Everything else (people, projects, POs, money) stays fake on test:
// fill it with `npm run test-env:seed`.
//
// The test ERP's existing setup is REPLACED. Who created a template or branch
// is cleared, because those people don't exist on test.
//
// Usage:  npm run test-env:copy-setup
// Needs in .env.local: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (live)
//                      TEST_SUPABASE_URL + TEST_SUPABASE_SERVICE_ROLE_KEY (test)

import { createClient } from "@supabase/supabase-js";

const need = (name) => {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name} in .env.local`);
  return v;
};
const liveUrl = need("NEXT_PUBLIC_SUPABASE_URL");
const testUrl = need("TEST_SUPABASE_URL");
if (new URL(liveUrl).host === new URL(testUrl).host) {
  throw new Error("TEST_SUPABASE_URL points at the live project — refusing to touch it.");
}
const opts = { auth: { persistSession: false, autoRefreshToken: false } };
const live = createClient(liveUrl, need("SUPABASE_SERVICE_ROLE_KEY"), opts);
const test = createClient(testUrl, need("TEST_SUPABASE_SERVICE_ROLE_KEY"), opts);

// In insert order (parents first). key = primary key; people = columns naming a
// person, cleared on the copy.
const TABLES = [
  { name: "departments", key: ["id"] },
  { name: "module_settings", key: ["module_id"] },
  { name: "department_modules", key: ["department_id", "module_id"] },
  { name: "department_subteams", key: ["id"] },
  { name: "project_concept_visibility", key: ["owner_department_id", "viewer_department_id"] },
  { name: "roles", key: ["id"] },
  { name: "role_permissions", key: ["role_id", "resource", "action"] },
  { name: "approval_flows", key: ["id"] },
  { name: "approval_stages", key: ["id"] },
  { name: "design_folder_types", key: ["key"] },
  { name: "design_folder_access", key: ["folder_key", "role_id"] },
  { name: "pettycash_categories", key: ["id"] },
  { name: "project_step_templates", key: ["id"] },
  { name: "design_templates", key: ["id"] },
  { name: "design_template_versions", key: ["id"], people: ["created_by"] },
  { name: "design_template_sections", key: ["id"] },
  { name: "design_template_questions", key: ["id"] },
  { name: "design_template_columns", key: ["id"] },
  { name: "billing_branches", key: ["id"], people: ["created_by"] },
];

async function readAll(client, table) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client.from(table).select("*").range(from, from + 999);
    if (error) throw new Error(`Reading ${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const check = (what, { error }) => {
  if (error) throw new Error(`${what}: ${error.message}`);
};

console.log(`Copying the live setup into the test ERP (${new URL(testUrl).host})\n`);

const copies = [];
for (const t of TABLES) {
  const rows = await readAll(live, t.name);
  for (const r of rows) for (const p of t.people ?? []) r[p] = null;
  copies.push({ ...t, rows });
}

// Clear the test setup, children first.
for (const t of [...TABLES].reverse()) {
  check(`Clearing ${t.name}`, await test.from(t.name).delete().not(t.key[0], "is", null));
}

// Fill it, parents first. Upsert, because adding a department seeds its own
// concept-visibility rows on the way in.
for (const t of copies) {
  for (let i = 0; i < t.rows.length; i += 500) {
    check(
      `Copying ${t.name}`,
      await test.from(t.name).upsert(t.rows.slice(i, i + 500), { onConflict: t.key.join(",") })
    );
  }
  console.log(`  ✓ ${t.name.padEnd(28)} ${t.rows.length} rows`);
}

console.log("\n✓ The test ERP now has the live setup (no people, projects or money copied).");
