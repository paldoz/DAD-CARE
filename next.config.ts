import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Compress all responses — reduces bandwidth significantly
  compress: true,

  // Remove X-Powered-By header — tiny bandwidth saving on every response
  poweredByHeader: false,

  // Enable Vercel's built-in Image CDN for faster avatar loading
  images: {
    unoptimized: false,
    formats: ['image/webp', 'image/avif'],
  },

  // Aggressive browser caching for static assets (JS/CSS/fonts)
  // These files are hashed so they can be cached for 1 year safely
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },

  // Silence workspace root warning
  turbopack: {
    root: __dirname,
  },

  // Reduce bundle size by removing server-side source maps in production
  productionBrowserSourceMaps: false,
};

export default nextConfig;
