import Link from "next/link";
import { ShieldX } from "lucide-react";

import { ACTIONS, type Action, permissionMessage } from "@/core/rbac/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Friendly "you don't have permission" screen. `requirePermission` redirects
 * here with the resource/action a user lacked, so the message is specific
 * instead of a silent bounce to the dashboard.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ resource?: string; action?: string }>;
}) {
  const { resource, action } = await searchParams;
  const isAction = (a: string | undefined): a is Action =>
    !!a && (ACTIONS as readonly string[]).includes(a);

  const message =
    resource && isAction(action)
      ? permissionMessage(resource, action)
      : "You don't have permission to view this page.";

  return (
    <div className="mx-auto max-w-md py-12">
      <Card>
        <CardHeader>
          <div className="bg-destructive/10 text-destructive mb-2 flex size-10 items-center justify-center rounded-full">
            <ShieldX className="size-5" />
          </div>
          <CardTitle>Access denied</CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-muted-foreground text-sm">
            If you think you should have access, ask an administrator to grant
            your role the right permission under Access Control.
          </p>
          <Button asChild>
            <Link href="/dashboard">Back to Dashboard</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
