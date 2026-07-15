import type { ErrorSource } from "@/modules/errorlog/log";

/** Plain-English label for where an error came from. */
export function sourceLabel(source: ErrorSource | string): string {
  switch (source) {
    case "client":
      return "Website";
    case "server":
      return "Backend";
    default:
      return source;
  }
}

/** Who hit the error — email, or a clear fallback when it was unauthenticated. */
export function errorActor(email: string | null): string {
  return email?.trim() || "Not signed in";
}
