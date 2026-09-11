import type { Action } from "@/core/rbac/types";

/** A person on a department's team. */
export type TeamMember = {
  department_id: string;
  user_id: string;
  /** Works across every project in the department, via all_projects_role_id. */
  all_projects: boolean;
  /** The project role applied on all projects when all_projects is on. */
  all_projects_role_id: string | null;
};

/** A project role in a department, for the "sees all projects" picker. */
export type TeamRole = { id: string; label: string; department_id: string | null };

/** One per-user grant within a department. */
export type TeamGrant = {
  department_id: string;
  user_id: string;
  resource: string;
  action: Action;
};
