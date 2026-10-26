import "server-only";

import { env } from "@/core/config/env";
import { escapeHtml, sendEmail, type MailResult } from "@/core/alerts/mailer";
import { createAdminClient } from "@/core/supabase/admin";
import { errorActor, sourceLabel } from "@/modules/errorlog/format";

type AlertRow = {
  id: string;
  occurred_at: string;
  source: string;
  context: string;
  message: string;
  path: string | null;
  user_email: string | null;
};

const istTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });

const siteLink = (path: string) => (env.NEXT_PUBLIC_SITE_URL ? `${env.NEXT_PUBLIC_SITE_URL}${path}` : null);

/** The alert emails' recipients: the IT department, or admins while IT is empty. */
export async function alertRecipientEmails(): Promise<string[]> {
  const { data } = await createAdminClient().rpc("alert_recipients");
  return ((data ?? []) as { email: string }[]).map((r) => r.email);
}

/**
 * Email every error logged since the last alert, as one message. Does nothing
 * when an alert went out in the last 15 minutes — the database's 5-minute job
 * sends the rest once that gap has passed. When sending fails the errors are
 * released again, so the next attempt includes them.
 */
export async function sendErrorAlerts(): Promise<{ sent: number } | { error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("claim_error_alert_batch");
  if (error) return { error: error.message };
  const rows = (data ?? []) as AlertRow[];
  if (rows.length === 0) return { sent: 0 };

  const res = await sendEmail({ to: await alertRecipientEmails(), ...composeErrorAlert(rows) });
  if (!res.ok) {
    await admin.from("error_logs").update({ alerted_at: null }).in("id", rows.map((r) => r.id));
    return { error: res.error };
  }
  return { sent: rows.length };
}

/** A test email to the alert recipients, so the setup can be checked. */
export async function sendTestAlert(): Promise<MailResult> {
  const link = siteLink("/logs");
  return sendEmail({
    to: await alertRecipientEmails(),
    subject: "ERP alerts are working",
    text: `This is a test. When something breaks in the ERP, an email like this one arrives here.${link ? `\n\nError Log: ${link}` : ""}`,
    html: `<p>This is a test. When something breaks in the ERP, an email like this one arrives here.</p>${
      link ? `<p><a href="${escapeHtml(link)}">Open the Error Log</a></p>` : ""
    }`,
  });
}

function composeErrorAlert(rows: AlertRow[]) {
  const sorted = [...rows].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const n = sorted.length;
  const subject = `ERP: ${n} new error${n === 1 ? "" : "s"} — ${sorted[n - 1].message.slice(0, 60)}`;
  const link = siteLink("/logs");
  const lines = sorted.map(
    (r) =>
      `• ${istTime(r.occurred_at)} — ${sourceLabel(r.source)}, ${r.context}${r.path ? ` (${r.path})` : ""}\n` +
      `  ${r.message}\n  Who: ${errorActor(r.user_email)}`
  );
  const text = [
    `${n} new error${n === 1 ? " was" : "s were"} recorded in the ERP:`,
    "",
    ...lines,
    "",
    link ? `Details: ${link}` : "Details: IT → Error Log",
  ].join("\n");
  const html =
    `<p>${n} new error${n === 1 ? " was" : "s were"} recorded in the ERP:</p><ul>` +
    sorted
      .map(
        (r) =>
          `<li><b>${escapeHtml(istTime(r.occurred_at))}</b> — ${escapeHtml(sourceLabel(r.source))}, ` +
          `${escapeHtml(r.context)}${r.path ? ` (${escapeHtml(r.path)})` : ""}<br>` +
          `${escapeHtml(r.message)}<br><small>Who: ${escapeHtml(errorActor(r.user_email))}</small></li>`
      )
      .join("") +
    `</ul><p>${link ? `<a href="${escapeHtml(link)}">Open the Error Log</a>` : "Details: IT → Error Log"}</p>`;
  return { subject, text, html };
}
