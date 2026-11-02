import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  outputFileTracingIncludes: {
    "/api/analyze": ["./cache/**/*", "./public/samples/**/*"],
  },
};

export default nextConfig;
