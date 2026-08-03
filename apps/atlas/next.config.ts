import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Emits `.next/standalone` with a self-contained server and only the modules
  // it actually needs. Nova bundles that output and runs it in-process, so the
  // desktop app ships without a hosted Atlas deployment.
  output: "standalone",

  // The workspace root is two levels up; without this Next traces files from
  // the app directory and misses the hoisted pnpm store.
  outputFileTracingRoot: path.join(import.meta.dirname, "../../"),

  // Internal packages ship raw TypeScript, so Next compiles them itself.
  transpilePackages: [
    "@vestra/api",
    "@vestra/config",
    "@vestra/core",
    "@vestra/provider-sdk",
    "@vestra/providers",
    "@vestra/storage",
    "@vestra/types",
    "@vestra/ui",
  ],

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org" },
      { protocol: "https", hostname: "s4.anilist.co" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
    ],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
