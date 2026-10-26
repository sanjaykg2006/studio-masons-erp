"use client";

import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { sendTestAlertEmail } from "@/modules/errorlog/actions";

/** Sends a test alert email and says, right beside the button, how it went. */
export function TestAlertButton() {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const send = () =>
    startTransition(async () => {
      setResult(null);
      const res = await sendTestAlertEmail();
      setResult(
        res.ok
          ? { ok: true, text: "Sent — check the inbox (and the spam folder, the first time)." }
          : { ok: false, text: res.error }
      );
    });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button size="sm" variant="outline" disabled={pending} onClick={send}>
        {pending ? "Sending…" : "Send a test email"}
      </Button>
      {result && (
        <span
          role="status"
          className={result.ok ? "text-xs text-emerald-700 dark:text-emerald-400" : "text-destructive text-xs"}
        >
          {result.text}
        </span>
      )}
    </div>
  );
}
