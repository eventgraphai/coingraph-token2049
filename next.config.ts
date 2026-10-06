import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Agent-facing docs at the conventional top-level paths.
  async rewrites() {
    return [
      { source: "/llms.txt", destination: "/api/v1/llms.txt" },
      { source: "/openapi.json", destination: "/api/v1/openapi.json" },
    ];
  },
};

export default nextConfig;
