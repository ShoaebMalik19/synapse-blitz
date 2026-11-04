import type { NextConfig } from "next";

// Synapse pages show live orchestration state, so everything is rendered per request.
// Cache Components is disabled to keep data flow explicit (client polling of typed APIs).
const nextConfig: NextConfig = {
  cacheComponents: false,
  partialPrefetching: false,
  serverExternalPackages: ["better-sqlite3"],
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
