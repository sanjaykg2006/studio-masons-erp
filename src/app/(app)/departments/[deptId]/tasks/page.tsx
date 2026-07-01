import { notFound } from "next/navigation";

import { getDepartmentTasksData } from "@/modules/design/task-data";
import { TasksView } from "@/modules/design/components/tasks-view";

/** A department's task board + calendar (generic; works for any department). */
export default async function DepartmentTasksPage({
  params,
}: {
  params: Promise<{ deptId: string }>;
}) {
  const { deptId } = await params;
  const data = await getDepartmentTasksData(deptId);
  if (!data) notFound();

  return (
    <TasksView
      departmentId={data.departmentId}
      tasks={data.tasks}
      people={data.people}
      subteams={data.subteams}
      projects={data.projects}
    />
  );
}
