import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Server Actions default to a 1 MB request body, which a real Budget BOQ /
    // comparison spreadsheet upload (and the parsed rows sent back on confirm)
    // blow past — Next 413s before our own try/catch can run. Raise it so
    // multi-MB workbooks import instead of crashing the page.
    serverActions: {
      bodySizeLimit: "15mb",
    },
  },
};

export default nextConfig;
