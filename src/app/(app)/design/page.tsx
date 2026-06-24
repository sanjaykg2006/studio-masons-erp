import { redirect } from "next/navigation";

import { can } from "@/core/rbac/can";
import { hasDesignAccess } from "@/core/rbac/permissions";
import { listProjects } from "@/modules/design/data";
import { ProjectsList } from "@/modules/design/components/projects-list";

/** Design Department home — the project list. */
export default async function DesignPage() {
  // Department-wide users OR any project member may land here; the list itself
  // is RLS-filtered to the projects each person can actually see.
  if (!(await hasDesignAccess())) {
    redirect("/forbidden?resource=design.project&action=read");
  }
  const [projects, canCreate, canTemplates] = await Promise.all([
    listProjects(),
    can("design.project", "create"),
    can("design.template", "read"),
  ]);
  return (
    <ProjectsList projects={projects} canCreate={canCreate} canTemplates={canTemplates} />
  );
}
