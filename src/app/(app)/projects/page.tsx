import { redirect } from "next/navigation";

import { can } from "@/core/rbac/can";
import { hasProjectAccess } from "@/core/rbac/permissions";
import { getConceptVisibility, listProjects } from "@/modules/projects/data";
import { ProjectsList } from "@/modules/projects/components/projects-list";
import { ConceptVisibilityMatrix } from "@/modules/projects/components/concept-visibility-matrix";

/** Projects home — the company-wide project list (tagged by department). */
export default async function ProjectsPage() {
  // Department-wide users OR any project member may land here; the list itself
  // is RLS-filtered to the projects each person can actually see.
  if (!(await hasProjectAccess())) {
    redirect("/forbidden?resource=project&action=read");
  }
  const [projects, canCreate, canTemplates, canAdminAccess] = await Promise.all([
    listProjects(),
    can("project", "create"),
    can("project.template", "read"),
    can("access", "update"),
  ]);
  // The Concept-visibility grid is an access-control setting, so it is only
  // loaded (and only shown) for someone who administers access.
  const visibility = canAdminAccess ? await getConceptVisibility() : null;

  return (
    <div className="space-y-6">
      <ProjectsList
        projects={projects}
        canCreate={canCreate}
        canTemplates={canTemplates}
      />
      {visibility && <ConceptVisibilityMatrix data={visibility} />}
    </div>
  );
}
