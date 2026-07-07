import { can } from "@/core/rbac/can";
import {
  listPettyCashCategories,
  listPettyCashEntries,
  listVisibleProjects,
} from "@/modules/pettycash/data";
import { PettyCashView } from "@/modules/pettycash/components/pettycash-view";

/**
 * Petty Cash — open to any authenticated employee (the (app) layout already guards
 * sign-in). Normal employees see their own entries; Billing/Accounts/MD see all.
 */
export default async function PettyCashPage() {
  const [entries, categories, projects, canManageCategories] = await Promise.all([
    listPettyCashEntries(),
    listPettyCashCategories(false),
    listVisibleProjects(),
    can("pettycash.category", "manage"),
  ]);

  return (
    <PettyCashView
      entries={entries}
      categories={categories}
      projects={projects}
      canManageCategories={canManageCategories}
    />
  );
}
