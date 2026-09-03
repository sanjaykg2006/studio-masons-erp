import { redirect } from "next/navigation";

import { getUser } from "@/core/auth/get-user";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SetPasswordForm } from "./set-password-form";

/**
 * Where an invited person lands after clicking their invite link.
 *
 * The link already signed them in (that is how Supabase invites work), so this
 * page is reached WITH a session — it just gives them a password of their own
 * so they aren't dependent on magic links from here on. Anyone arriving without
 * a session has no account to set a password for, so they go to /login.
 */
export default async function SetPasswordPage() {
  const user = await getUser();
  if (!user) redirect("/login");

  return (
    <div className="bg-muted/40 flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">
            Studio-<span className="text-primary">Masons</span> ERP
          </CardTitle>
          <CardDescription>
            Welcome{user.email ? `, ${user.email}` : ""} — choose a password to
            finish setting up your account.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SetPasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
