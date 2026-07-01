import { requirePermission, can } from "@/core/rbac/can";
import { listTemplates } from "@/modules/design/data";
import { TemplateLibrary } from "@/modules/design/components/template-library";

/** The general, company-wide template library (usable across projects). */
export default async function ProjectTemplatesPage() {
  await requirePermission("project.template", "read");
  const [templates, canCreate] = await Promise.all([
    listTemplates("general"),
    can("project.template", "create"),
  ]);
  return (
    <TemplateLibrary
      templates={templates}
      canCreate={canCreate}
      scope="general"
      basePath="/projects/templates"
      backHref="/projects"
      backLabel="Projects"
      heading="Project templates"
      description="General, company-wide templates usable at any point in a project. Editing publishes a new version; briefs already filled keep the version they used."
    />
  );
}
