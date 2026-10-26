import { NextResponse } from "next/server";

import { env } from "@/core/config/env";
import { cronAuthorized } from "@/core/alerts/cron-auth";
import { escapeHtml, sendEmail } from "@/core/alerts/mailer";
import { createAdminClient } from "@/core/supabase/admin";
import { listWaitingApprovals } from "@/modules/access/approval-data";
import { alertRecipientEmails } from "@/modules/errorlog/alerts";

export const dynamic = "force-dynamic";

/**
 * Called at 09:00 IST by the database (pg_cron, 0105): emails the approvals
 * that are stuck — nobody can give the step, or it has waited a week. Nothing
 * is sent on a day when nothing is stuck.
 */
export async function POST(request: Request) {
  if (!cronAuthorized(request)) return NextResponse.json({ error: "Not allowed" }, { status: 401 });

  const stuck = (await listWaitingApprovals(createAdminClient())).filter((w) => w.stuck);
  if (stuck.length === 0) return NextResponse.json({ stuck: 0 });

  const link = env.NEXT_PUBLIC_SITE_URL ? `${env.NEXT_PUBLIC_SITE_URL}/access/approvals/waiting` : null;
  const describe = (w: (typeof stuck)[number]) => ({
    title: `${w.flow_label}${w.item_ref ? ` · ${w.item_ref}` : ""}${w.project_label ? ` (${w.project_label})` : ""}`,
    detail:
      `Step ${w.stage_no} of ${w.stage_count}: ${w.stage_label}` +
      `${w.approver_label ? `, given by ${w.approver_label}` : ""} · waiting ${w.days_waiting} day${w.days_waiting === 1 ? "" : "s"} · ` +
      (w.can_approve.length ? `can approve: ${w.can_approve.join(", ")}` : "NOBODY can approve it"),
  });
  const items = stuck.map(describe);
  const n = stuck.length;

  const res = await sendEmail({
    to: await alertRecipientEmails(),
    subject: `ERP: ${n} approval${n === 1 ? " is" : "s are"} stuck`,
    text: [
      `${n} approval${n === 1 ? " is" : "s are"} stuck (nobody can approve, or waiting 7+ days):`,
      "",
      ...items.map((i) => `• ${i.title}\n  ${i.detail}`),
      "",
      link ? `See them all: ${link}` : "See them all: IT → Waiting approvals",
    ].join("\n"),
    html:
      `<p>${n} approval${n === 1 ? " is" : "s are"} stuck (nobody can approve, or waiting 7+ days):</p><ul>` +
      items.map((i) => `<li><b>${escapeHtml(i.title)}</b><br>${escapeHtml(i.detail)}</li>`).join("") +
      `</ul><p>${link ? `<a href="${escapeHtml(link)}">See them all</a>` : "See them all: IT → Waiting approvals"}</p>`,
  });
  return NextResponse.json(res.ok ? { stuck: n } : { error: res.error }, { status: res.ok ? 200 : 500 });
}
