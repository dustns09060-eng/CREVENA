import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // photo uploads (resized JPEGs + thumbnails) go through server actions
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
