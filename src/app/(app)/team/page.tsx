import { redirect } from "next/navigation";

/**
 * The old standalone "Team Access" door has been folded into each department's
 * "People & Access" screen. Anyone landing here (old link/bookmark) is sent to
 * the Departments hub, where they pick a department and manage its people there.
 */
export default function TeamAccessRedirect() {
  redirect("/departments");
}
