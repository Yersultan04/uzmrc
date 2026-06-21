import type { NextConfig } from "next";

// Origin of our FastAPI backend (no trailing slash). The backend serves under
// the `/api` prefix, so the rewrite below preserves `/api` in the destination.
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:8088";

const nextConfig: NextConfig = {
  output: "standalone",
  images: {
    unoptimized: true,
  },
  experimental: {
    proxyClientMaxBodySize: "1gb",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${BACKEND_URL}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
