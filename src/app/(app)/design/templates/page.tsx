import { requirePermission, can } from "@/core/rbac/can";
import { listTemplates } from "@/modules/design/data";
import { TemplateLibrary } from "@/modules/design/components/template-library";

/** The Design department's own template library. */
export default async function DesignTemplatesPage() {
  await requirePermission("design.template", "read");
  const [templates, canCreate, canDelete] = await Promise.all([
    listTemplates("design"),
    can("design.template", "create"),
    can("design.template", "delete"),
  ]);
  return (
    <TemplateLibrary
      templates={templates}
      canCreate={canCreate}
      canDelete={canDelete}
      scope="design"
      basePath="/design/templates"
      backHref="/design"
      backLabel="Design Department"
      heading="Design templates"
      description="The Design department's own templates. Editing publishes a new version."
    />
  );
}
