import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // This checkout is a git worktree nested under a directory that carries its
  // own lockfile, so pin the workspace root instead of letting it be inferred.
  turbopack: {
    root: path.resolve("."),
  },
};

export default nextConfig;
