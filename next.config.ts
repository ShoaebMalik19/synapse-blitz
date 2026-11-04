import type { NextConfig } from "next";

// Synapse pages show live orchestration state, so everything is rendered per request.
// Cache Components is disabled to keep data flow explicit (client polling of typed APIs).
const nextConfig: NextConfig = {
  cacheComponents: false,
  partialPrefetching: false,
  serverExternalPackages: ["better-sqlite3"],
  // Public, static, read-only replay of the recorded run (no API/DB dependency).
  // On serverless hosting (Vercel) every instance has its own /tmp, so a SQLite file can't be shared.
  // When API_ORIGIN is set, all /api/* calls go to the persistent Synapse backend (orchestrator,
  // workers and database) instead. Unset locally, so the app serves its own API.
  async rewrites() {
    const origin = process.env.API_ORIGIN?.replace(/\/$/, "");
    return {
      beforeFiles: origin ? [{ source: "/api/:path*", destination: `${origin}/api/:path*` }] : [],
      afterFiles: [{ source: "/replay", destination: "/replay/index.html" }],
      fallback: [],
    };
  },
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
