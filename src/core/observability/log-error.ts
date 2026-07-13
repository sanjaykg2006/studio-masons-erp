/**
 * Dead-simple client error logging. When a React error boundary trips, it calls
 * this so the failure lands in the browser console AND — because Next forwards
 * console output from the client through to the server logs on the host (e.g.
 * Vercel) — somewhere you can actually find it during testing.
 *
 * Deliberately minimal: no third-party service yet. When you're ready for real
 * alerting, swap the body of this function for a Sentry (or similar) call and
 * every boundary starts reporting automatically.
 */
export function logClientError(where: string, error: Error & { digest?: string }) {
  // The `[erp-error]` prefix makes these easy to grep for in the host's logs.
  console.error(`[erp-error] ${where}`, {
    message: error.message,
    digest: error.digest,
    stack: error.stack,
  });
}
