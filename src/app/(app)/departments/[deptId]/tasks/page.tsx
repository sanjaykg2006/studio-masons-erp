import { notFound } from "next/navigation";

import { getDepartment } from "@/modules/departments/data";
import { DEPARTMENT_HOME } from "@/modules/departments/home";
import { getDepartmentTasksData } from "@/modules/design/task-data";
import { TasksView } from "@/modules/design/components/tasks-view";

/** A department's task board + calendar (generic; works for any department). */
export default async function DepartmentTasksPage({
  params,
}: {
  params: Promise<{ deptId: string }>;
}) {
  const { deptId } = await params;
  const [data, dept] = await Promise.all([
    getDepartmentTasksData(deptId),
    getDepartment(deptId),
  ]);
  if (!data || !dept) notFound();

  // Back to this department's own home (its rich hub if it has one, else the
  // generic workspace) — never a hardcoded department.
  const backHref = DEPARTMENT_HOME[dept.key] ?? `/departments/${deptId}`;

  return (
    <TasksView
      departmentId={data.departmentId}
      tasks={data.tasks}
      people={data.people}
      subteams={data.subteams}
      projects={data.projects}
      canCreate={data.canCreate}
      canManage={data.canManage}
      backHref={backHref}
      backLabel={dept.label}
      subtitle={`The ${dept.label} team's to-do board and calendar.`}
    />
  );
}
