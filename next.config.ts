import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  async redirects() {
    return [
      { source: "/arc", destination: "/", permanent: false },
      { source: "/arc/:path*", destination: "/", permanent: false },
    ];
  },
};

export default nextConfig;
