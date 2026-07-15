import { requireUser } from "@/core/auth/get-user";
import { getDashboardData } from "@/modules/dashboard/data";
import { DashboardView } from "@/modules/dashboard/components/dashboard-view";

export default async function DashboardPage() {
  const user = await requireUser();
  const data = await getDashboardData(user.id);
  return <DashboardView data={data} />;
}
