import { redirect } from "next/navigation";

import { getUser } from "@/core/auth/get-user";

/**
 * Landing route. Sends authenticated users to the dashboard and everyone else
 * to login. The app itself lives under the (app) route group.
 */
export default async function Home() {
  const user = await getUser();
  redirect(user ? "/dashboard" : "/login");
}
