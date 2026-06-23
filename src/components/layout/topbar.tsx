import Image from "next/image";
import { LogOut } from "lucide-react";

import { signOut } from "@/core/auth/actions";
import type { AppUser } from "@/core/auth/types";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Initials for the avatar fallback, derived from the user's email. */
function initials(email: string | null) {
  if (!email) return "?";
  return email.slice(0, 2).toUpperCase();
}

/** Top bar with the user menu and sign-out (a Server Action form). */
export function Topbar({ user }: { user: AppUser }) {
  return (
    <header className="flex h-16 items-center justify-between border-b px-5">
      <Image
        src="/studio-masons-logo.svg"
        alt="Studio Masons"
        width={56}
        height={28}
        priority
        className="h-12 w-auto md:hidden"
      />
      <div className="ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              className="flex items-center gap-2 px-2"
            >
              <Avatar>
                <AvatarFallback>{initials(user.email)}</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm sm:inline">{user.email}</span>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="truncate">
              {user.email}
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <form action={signOut}>
              <DropdownMenuItem variant="destructive" asChild>
                <button
                  type="submit"
                  className="flex w-full cursor-pointer items-center gap-2"
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </DropdownMenuItem>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
