import "server-only";

import { createClient } from "@/core/supabase/server";
import { listProjects } from "@/modules/design/data";
import type {
  TaskPerson,
  TaskProjectRef,
  TaskRow,
  TaskSubteam,
} from "@/modules/design/task-types";

export type TasksPageData = {
  departmentId: string;
  tasks: TaskRow[];
  people: TaskPerson[];
  subteams: TaskSubteam[];
  projects: TaskProjectRef[];
};

/**
 * The task board data for ANY department: the tasks the caller may see (privacy
 * enforced in the RPC), the team members (assignee picker), the sub-teams, and
 * the projects a task can be linked to. Returns null if the caller isn't on that
 * department's team (nothing to show).
 */
export async function getDepartmentTasksData(
  departmentId: string
): Promise<TasksPageData | null> {
  const supabase = await createClient();

  const { data: access } = await supabase.rpc("on_department_team", {
    p_dept: departmentId,
  });
  if (!access) return null;

  const [tasksRes, peopleRes, subteamsRes, projects] = await Promise.all([
    supabase.rpc("list_department_tasks", { p_dept: departmentId }),
    supabase.rpc("list_department_team", { p_dept: departmentId }),
    supabase.rpc("list_department_subteams", { p_dept: departmentId }),
    listProjects(),
  ]);

  return {
    departmentId,
    tasks: (tasksRes.data ?? []) as TaskRow[],
    people: (peopleRes.data ?? []) as TaskPerson[],
    subteams: (subteamsRes.data ?? []) as TaskSubteam[],
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
  };
}

/** The Design department's tasks (convenience wrapper for /design/tasks). */
export async function getDesignTasksData(): Promise<TasksPageData | null> {
  const supabase = await createClient();
  const { data: departmentId } = await supabase.rpc("design_department_id");
  if (!departmentId) return null;
  return getDepartmentTasksData(departmentId as string);
}
