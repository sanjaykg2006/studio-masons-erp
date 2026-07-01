import { redirect } from "next/navigation";

import { can } from "@/core/rbac/can";
import { hasProjectAccess } from "@/core/rbac/permissions";
import { listProjects } from "@/modules/design/data";
import { ProjectsList } from "@/modules/design/components/projects-list";

/** Projects home — the company-wide project list (tagged by department). */
export default async function ProjectsPage() {
  // Department-wide users OR any project member may land here; the list itself
  // is RLS-filtered to the projects each person can actually see.
  if (!(await hasProjectAccess())) {
    redirect("/forbidden?resource=project&action=read");
  }
  const [projects, canCreate] = await Promise.all([
    listProjects(),
    can("project", "create"),
  ]);
  return <ProjectsList projects={projects} canCreate={canCreate} />;
}
