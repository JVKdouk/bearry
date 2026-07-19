import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  // antd v5 works best when transpiled by Next in the app dir.
  transpilePackages: [
    "antd",
    "@ant-design/icons",
    "@ant-design/cssinjs",
    "rc-util",
    "rc-pagination",
    "rc-picker",
    "rc-notification",
    "rc-tooltip",
  ],
  experimental: {
    /**
     * Rewrite barrel imports (`import { X } from "antd"`) into deep paths at
     * build time, so a page that uses three antd components doesn't pull the
     * whole library's module graph through the bundler. `@ant-design/icons` is
     * the worst offender — its index re-exports ~800 icon components, and
     * without this every one of them is walked on every page that imports a
     * single icon. Measured effect is on compile time and on how much dead code
     * survives to the chunk.
     */
    optimizePackageImports: ["antd", "@ant-design/icons", "lucide-react", "dayjs"],
  },
  /**
   * Strip React's prop-types and other dev-only checks from the production
   * bundle. Small, but free.
   */
  compiler: {
    removeConsole: process.env.NODE_ENV === "production" ? { exclude: ["error", "warn"] } : false,
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        // Content-hashed immutable assets can be cached forever — the hash in
        // the filename changes when the content does, so a stale copy is never
        // served. Next sets this itself when it serves them, but the standalone
        // server behind nginx doesn't always, and re-downloading the framework
        // on every visit is the single most wasteful thing a returning user
        // does.
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
    ];
  },
};

export default nextConfig;
