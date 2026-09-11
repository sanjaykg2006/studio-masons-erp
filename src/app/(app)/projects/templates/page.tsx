import { requireAnywhere, canAnywhere } from "@/core/rbac/can";
import { listTemplates } from "@/modules/design/data";
import { getStepTemplates } from "@/modules/projects/data";
import { TemplateLibrary } from "@/modules/design/components/template-library";
import { DefaultChecklistCard } from "@/modules/projects/components/default-checklist-card";

/** The general, company-wide template library (usable across projects). Access
 * is a project-role ability held on any project — see canAnywhere. */
export default async function ProjectTemplatesPage() {
  await requireAnywhere("project.template", "read");
  const [templates, steps, canCreate, canDelete, canEditSteps] = await Promise.all([
    listTemplates("general"),
    getStepTemplates(),
    canAnywhere("project.template", "create"),
    canAnywhere("project.template", "delete"),
    canAnywhere("project.template", "update"),
  ]);
  return (
    <div className="space-y-6">
      <TemplateLibrary
        templates={templates}
        canCreate={canCreate}
        canDelete={canDelete}
        scope="general"
        basePath="/projects/templates"
        backHref="/projects"
        backLabel="Projects"
        heading="Project templates"
        description="General, company-wide templates usable at any point in a project. Editing publishes a new version; briefs already filled keep the version they used."
      />
      {/* The progress checklist lives here rather than in Design's settings: it
          starts every project, whichever department owns it. */}
      <DefaultChecklistCard steps={steps} canEdit={canEditSteps} />
    </div>
  );
}
