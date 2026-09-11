import { notFound } from "next/navigation";

import { requireAnywhere, canAnywhere } from "@/core/rbac/can";
import { getEditableTemplate } from "@/modules/design/data";
import { TemplateEditor } from "@/modules/design/components/template-editor";

export default async function ProjectTemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  await requireAnywhere("project.template", "read");
  const { templateId } = await params;

  const tree = await getEditableTemplate(templateId);
  if (!tree) notFound();

  const [canEdit, canApprove] = await Promise.all([
    canAnywhere("project.template", "update"),
    canAnywhere("project.template", "approve"),
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
