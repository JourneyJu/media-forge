import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@mediaforge/contracts"],
  devIndicators: false
};

export default nextConfig;
