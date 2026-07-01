import { notFound } from "next/navigation";

import { requireProjectPermission } from "@/core/rbac/can";
import { createClient } from "@/core/supabase/server";
import { getFolderFiles, getProjectFolders } from "@/modules/design/data";
import { FolderDetail } from "@/modules/design/components/folder-detail";

export default async function FolderPage({
  params,
}: {
  params: Promise<{ projectId: string; folderKey: string }>;
}) {
  const { projectId, folderKey } = await params;
  await requireProjectPermission(projectId, "project", "read");

  const folders = await getProjectFolders(projectId);
  const folder = folders.find((f) => f.folder_key === folderKey);
  // No access to this folder (rank 0) → behave as not found.
  if (!folder || folder.rank < 1) notFound();

  const [files, project] = await Promise.all([
    getFolderFiles(projectId, folderKey),
    createClient().then((s) =>
      s.from("projects").select("name").eq("id", projectId).maybeSingle()
    ),
  ]);

  const canWrite = folder.rank >= 3 || (folder.rank >= 2 && !folder.locked);
  const canIssue =
    folderKey === "working_drawings" &&
    (folders.find((f) => f.folder_key === "gfc_issued")?.rank ?? 0) >= 3;

  return (
    <FolderDetail
      projectId={projectId}
      projectName={project.data?.name ?? "Project"}
      folder={folder}
      files={files}
      canWrite={canWrite}
      canIssue={canIssue}
    />
  );
}
