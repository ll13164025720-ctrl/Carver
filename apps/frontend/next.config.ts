import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Monorepo: dependencies are hoisted to the repo root (npm workspaces), so
  // trace server files from there. Without this the deployed server bundle
  // can be missing `next` itself. The build runs from apps/frontend.
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
