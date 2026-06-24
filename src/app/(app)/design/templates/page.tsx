import { requirePermission, can } from "@/core/rbac/can";
import { listTemplates } from "@/modules/design/data";
import { TemplateLibrary } from "@/modules/design/components/template-library";

export default async function TemplatesPage() {
  await requirePermission("design.template", "read");
  const [templates, canCreate] = await Promise.all([
    listTemplates(),
    can("design.template", "create"),
  ]);
  return <TemplateLibrary templates={templates} canCreate={canCreate} />;
}
