import { redirect } from "next/navigation";

import { getDesignTasksData } from "@/modules/design/task-data";
import { TasksView } from "@/modules/design/components/tasks-view";

/** The Design department's internal to-do board + calendar. Visible to anyone on
 * the Design team; Concept / Technical tasks stay private to their own team. */
export default async function DesignTasksPage() {
  const data = await getDesignTasksData();
  if (!data) redirect("/forbidden?resource=design.template&action=read");

  return (
    <TasksView
      departmentId={data.departmentId}
      tasks={data.tasks}
      people={data.people}
      subteams={data.subteams}
      projects={data.projects}
      canCreate={data.canCreate}
      backHref="/design"
      backLabel="Design Department"
      subtitle="The Design team's to-do board. Concept and Technical tasks stay private to their own team."
    />
  );
}
