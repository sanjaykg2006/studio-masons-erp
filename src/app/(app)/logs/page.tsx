import { requirePermission } from "@/core/rbac/can";
import { getErrorLogs } from "@/modules/errorlog/data";
import type { ErrorSource } from "@/modules/errorlog/log";
import { ErrorLogView } from "@/modules/errorlog/components/error-log-view";

const PAGE_SIZE = 50;

export default async function ErrorLogPage({
  searchParams,
}: {
  searchParams: Promise<{ source?: string; page?: string }>;
}) {
  await requirePermission("errorlog", "read");
  const { source, page } = await searchParams;
  const pageNum = Math.max(0, Number.parseInt(page ?? "0", 10) || 0);
  const src = source === "client" || source === "server" ? (source as ErrorSource) : undefined;

  const { entries, total } = await getErrorLogs({ source: src, page: pageNum, pageSize: PAGE_SIZE });

  return (
    <ErrorLogView
      entries={entries}
      total={total}
      page={pageNum}
      pageSize={PAGE_SIZE}
      source={src}
    />
  );
}
