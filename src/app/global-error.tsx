"use client";

import { useEffect } from "react";

import { logClientError } from "@/core/observability/log-error";
import { reportClientError } from "@/modules/errorlog/actions";

/**
 * Last-resort fallback: catches errors thrown in the root layout itself (before
 * the normal app chrome renders). Because it replaces the whole document, it
 * ships its own <html>/<body> and self-contained inline styles — the app's CSS
 * isn't guaranteed to be loaded at this point.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    logClientError("global", error);
    void reportClientError({
      context: "global",
      message: error.message,
      digest: error.digest,
      detail: error.stack,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily:
            "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif",
          background: "#f8fafc",
          color: "#0f172a",
          padding: "1.5rem",
        }}
      >
        <div
          style={{
            maxWidth: "28rem",
            width: "100%",
            background: "#ffffff",
            border: "1px solid #e2e8f0",
            borderRadius: "0.75rem",
            padding: "1.5rem",
            boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
          }}
        >
          <h1 style={{ fontSize: "1.125rem", margin: "0 0 0.5rem" }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: "0.875rem", color: "#475569", margin: "0 0 1rem" }}>
            The app hit an unexpected problem. Please try again — if it keeps
            happening, let us know.
            {error.digest ? (
              <>
                {" "}
                Reference: <code style={{ fontSize: "0.75rem" }}>{error.digest}</code>.
              </>
            ) : null}
          </p>
          <button
            onClick={reset}
            style={{
              cursor: "pointer",
              border: "none",
              borderRadius: "0.5rem",
              background: "#0f172a",
              color: "#ffffff",
              fontSize: "0.875rem",
              fontWeight: 500,
              padding: "0.5rem 1rem",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
