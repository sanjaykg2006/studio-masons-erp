import { notFound } from "next/navigation";

import { createClient } from "@/core/supabase/server";
import { requireProjectPermission, canOnProject } from "@/core/rbac/can";
import { listProjectIntents, listReleasedBudgetLines } from "@/modules/procurement/intent-data";
import { Intents } from "@/modules/procurement/components/intents";

/** A project's purchase intents (Procurement slice 3). */
export default async function ProjectIntentsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  await requireProjectPermission(projectId, "procurement.intent", "read");

  const supabase = await createClient();
  const { data: project } = await supabase
    .from("projects")
    .select("name")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) notFound();

  const [intents, releasedLines, canCreate] = await Promise.all([
    listProjectIntents(projectId),
    listReleasedBudgetLines(projectId),
    canOnProject(projectId, "procurement.intent", "create"),
  ]);

  return (
    <Intents
      projectId={projectId}
      projectName={project.name as string}
      intents={intents}
      releasedLines={releasedLines}
      canCreate={canCreate}
    />
  );
}
