import { notFound } from "next/navigation";

import { requireProjectPermission } from "@/core/rbac/can";
import { getRejectionNotes } from "@/modules/access/rejection-notes";
import { getBriefDetail } from "@/modules/projects/data";
import { BriefForm } from "@/modules/projects/components/brief-form";

export default async function BriefPage({
  params,
}: {
  params: Promise<{ projectId: string; briefId: string }>;
}) {
  const { projectId, briefId } = await params;
  await requireProjectPermission(projectId, "project.brief", "read");

  const detail = await getBriefDetail(briefId);
  if (!detail || detail.brief.project_id !== projectId) notFound();
  const [briefNotes, revisionNotes] = await Promise.all([
    getRejectionNotes("brief", [briefId]),
    getRejectionNotes("brief_revision", [briefId]),
  ]);

  return (
    <BriefForm
      projectId={projectId}
      brief={detail.brief}
      projectName={detail.project.name}
      tree={detail.tree}
      answers={detail.answers}
      canEdit={detail.canEdit}
      frozen={detail.frozen}
      revisionState={detail.revisionState}
      revisionNo={detail.revisionNo}
      canProposeRevision={detail.canProposeRevision}
      briefApproval={detail.briefApproval}
      revisionApproval={detail.revisionApproval}
      rejection={revisionNotes[briefId] ?? briefNotes[briefId]}
    />
  );
}
