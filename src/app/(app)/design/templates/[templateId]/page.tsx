import { notFound } from "next/navigation";

import { requirePermission, can } from "@/core/rbac/can";
import { getEditableTemplate } from "@/modules/design/data";
import { TemplateEditor } from "@/modules/design/components/template-editor";

export default async function TemplateEditorPage({
  params,
}: {
  params: Promise<{ templateId: string }>;
}) {
  await requirePermission("design.template", "read");
  const { templateId } = await params;

  const tree = await getEditableTemplate(templateId);
  if (!tree) notFound();

  const canEdit = await can("design.template", "update");
  return <TemplateEditor templateId={templateId} tree={tree} canEdit={canEdit} />;
}
