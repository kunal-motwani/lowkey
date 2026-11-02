import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
  outputFileTracingIncludes: {
    "/api/analyze": ["./cache/**/*", "./public/samples/**/*"],
  },
};

export default nextConfig;
