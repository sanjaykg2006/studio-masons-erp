import { requirePermission } from "@/core/rbac/can";
import { getAuditData, listAuditDepartments } from "@/modules/audit/data";
import { AuditView } from "@/modules/audit/components/audit-view";

const PAGE_SIZE = 100;

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ dept?: string; page?: string }>;
}) {
  await requirePermission("audit", "read");
  const { dept, page } = await searchParams;
  const pageNum = Math.max(0, Number.parseInt(page ?? "0", 10) || 0);

  const [departments, { entries, total }] = await Promise.all([
    listAuditDepartments(),
    getAuditData({ scope: dept, page: pageNum, pageSize: PAGE_SIZE }),
  ]);

  return (
    <AuditView
      entries={entries}
      departments={departments}
      total={total}
      page={pageNum}
      pageSize={PAGE_SIZE}
      scope={dept}
    />
  );
}
