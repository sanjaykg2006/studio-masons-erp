import { notFound } from "next/navigation";

import { requirePermission, can } from "@/core/rbac/can";
import { getEditableTemplate } from "@/modules/design/data";
import { TemplateEditor } from "@/modules/design/components/template-editor";

export default async function ProjectTemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  await requirePermission("project.template", "read");
  const { templateId } = await params;

  const tree = await getEditableTemplate(templateId);
  if (!tree) notFound();

  const [canEdit, canApprove] = await Promise.all([
    can("project.template", "update"),
    can("project.template", "approve"),
  ]);
  return (
    <TemplateEditor
      templateId={templateId}
      tree={tree}
      canEdit={canEdit}
      canApprove={canApprove}
      backHref="/projects/templates"
    />
  );
}
