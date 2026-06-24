import { requirePermission, can } from "@/core/rbac/can";
import { listProjects } from "@/modules/design/data";
import { ProjectsList } from "@/modules/design/components/projects-list";

/** Design Department home — the project list. */
export default async function DesignPage() {
  await requirePermission("design.project", "read");
  const [projects, canCreate, canTemplates] = await Promise.all([
    listProjects(),
    can("design.project", "create"),
    can("design.template", "read"),
  ]);
  return (
    <ProjectsList projects={projects} canCreate={canCreate} canTemplates={canTemplates} />
  );
}
