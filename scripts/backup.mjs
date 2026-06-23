// One-command, independent backup of the linked Supabase database.
//
// Produces a COMPLETE, restorable snapshot in three parts (the combination
// Supabase recommends): cluster roles, schema (structure), and data. Files land
// in a timestamped folder under ./backups (git-ignored). Copy that folder to
// storage you control — OneDrive, an external drive, a cloud bucket — so you are
// not relying solely on the hosting provider.
//
// Usage:  npm run db:backup
// Requires:  the project to be linked once (npm run db:link).

import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const dir = join("backups", stamp);
mkdirSync(dir, { recursive: true });

// [filename, extra flags] — order matters for restoring later.
const parts = [
  ["roles.sql", "--role-only"],
  ["schema.sql", ""],
  ["data.sql", "--data-only --use-copy"],
];

console.log(`Backing up the linked database into ${dir}\n`);

for (const [file, flags] of parts) {
  const out = join(dir, file);
  console.log(`  -> ${file}`);
  execSync(`npx supabase db dump --linked ${flags} -f "${out}"`, {
    stdio: "inherit",
  });
}

console.log(`\n✓ Backup complete: ${dir}`);
console.log(
  "Now copy this folder to storage you control (OneDrive, external drive, cloud bucket)."
);
