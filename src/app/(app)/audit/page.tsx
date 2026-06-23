import { requirePermission } from "@/core/rbac/can";
import { getAuditData } from "@/modules/audit/data";
import { AuditView } from "@/modules/audit/components/audit-view";

export default async function AuditPage() {
  await requirePermission("audit", "read");
  const entries = await getAuditData();

  return <AuditView entries={entries} />;
}
