import { requireUser } from "@/core/auth/get-user";
import { DashboardView } from "@/modules/dashboard/components/dashboard-view";

export default async function DashboardPage() {
  const user = await requireUser();
  return <DashboardView user={user} />;
}
