import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Keep production builds separate from the dev (Turbopack) output so they
  // never clobber each other's `.next` directory.
  distDir:
    process.env.VERCEL === '1'
      ? '.next'
      : process.env.NODE_ENV === 'production'
        ? '.next-build'
        : '.next',
  images: {
    remotePatterns: [
      {
        hostname: 'avatar.vercel.sh',
      },
    ],
  },
};

export default nextConfig;
