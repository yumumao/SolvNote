import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  // Preserve canonical redirect origins; Next otherwise rewrites 127.0.0.1 to localhost.
  skipProxyUrlNormalize: true,
  serverExternalPackages: ['@prisma/client', 'bcryptjs'],
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'X-Frame-Options', value: 'DENY' },
      { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    ] }];
  },
};

export default nextConfig;
