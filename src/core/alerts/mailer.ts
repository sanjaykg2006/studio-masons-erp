import "server-only";

import nodemailer from "nodemailer";

import { serverEnv } from "@/core/config/server-env";

export type MailResult = { ok: true } | { ok: false; error: string };

/** Whether alert emails can go out at all (the Gmail account is configured). */
export function mailerConfigured(): boolean {
  const { ALERT_GMAIL_USER, ALERT_GMAIL_APP_PASSWORD } = serverEnv();
  return !!ALERT_GMAIL_USER && !!ALERT_GMAIL_APP_PASSWORD;
}

/**
 * Send one email from the alerts Gmail account. Never throws: alerting must not
 * break the thing that triggered it, so a failure comes back as a result.
 */
export async function sendEmail(input: {
  to: string[];
  subject: string;
  text: string;
  html: string;
}): Promise<MailResult> {
  const { ALERT_GMAIL_USER, ALERT_GMAIL_APP_PASSWORD } = serverEnv();
  if (!ALERT_GMAIL_USER || !ALERT_GMAIL_APP_PASSWORD) {
    return { ok: false, error: "Alert emails aren't set up (no Gmail account configured)." };
  }
  if (input.to.length === 0) return { ok: false, error: "Nobody to send the alert to." };

  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: ALERT_GMAIL_USER, pass: ALERT_GMAIL_APP_PASSWORD },
    });
    await transport.sendMail({
      from: `Studio-Masons ERP <${ALERT_GMAIL_USER}>`,
      // Each recipient sees only themselves.
      to: ALERT_GMAIL_USER,
      bcc: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Escape text for the HTML part of an email. */
export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
