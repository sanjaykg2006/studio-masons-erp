import { notFound } from "next/navigation";

import { requireProjectPermission } from "@/core/rbac/can";
import { getBriefDetail } from "@/modules/design/data";
import { BriefForm } from "@/modules/design/components/brief-form";

export default async function BriefPage({
  params,
}: {
  params: Promise<{ projectId: string; briefId: string }>;
}) {
  const { projectId, briefId } = await params;
  await requireProjectPermission(projectId, "design.brief", "read");

  const detail = await getBriefDetail(briefId);
  if (!detail || detail.brief.project_id !== projectId) notFound();

  return (
    <BriefForm
      projectId={projectId}
      brief={detail.brief}
      projectName={detail.project.name}
      tree={detail.tree}
      answers={detail.answers}
      canEdit={detail.canEdit}
      canReview={detail.canReview}
      canApprove={detail.canApprove}
    />
  );
}
