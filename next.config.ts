import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Preserve canonical redirect origins; Next otherwise rewrites 127.0.0.1 to localhost.
  skipProxyUrlNormalize: true,
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
};

export default nextConfig;
