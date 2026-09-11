import { can } from "@/core/rbac/can";
import {
  canSeeAllPettyCash,
  listPettyCashCategories,
  listPettyCashEntries,
  listVisibleProjects,
} from "@/modules/pettycash/data";
import { todayInIndia } from "@/modules/pettycash/analytics";
import { PettyCashView } from "@/modules/pettycash/components/pettycash-view";

/**
 * Petty Cash — open to any authenticated employee (the (app) layout already guards
 * sign-in). Normal employees see their own entries; Billing/Accounts/MD see all.
 */
export default async function PettyCashPage() {
  const [entries, categories, projects, canManageCategories, seesAll] = await Promise.all([
    listPettyCashEntries(),
    listPettyCashCategories(false),
    listVisibleProjects(),
    can("pettycash.category", "manage"),
    canSeeAllPettyCash(),
  ]);

  return (
    <PettyCashView
      entries={entries}
      categories={categories}
      projects={projects}
      canManageCategories={canManageCategories}
      seesAll={seesAll}
      // Worked out on the server in India time, so the overdue counts don't
      // depend on the viewer's clock.
      today={todayInIndia()}
    />
  );
}
