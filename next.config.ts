import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  output: 'export',          // Static HTML export — works on GitHub Pages
  reactStrictMode: false,
  images: { unoptimized: true },
  // If deployed to a sub-path like /war--jets-multiplayer/ set basePath:
  // basePath: '/war--jets-multiplayer',
  // assetPrefix: '/war--jets-multiplayer/',
  trailingSlash: true,
}

export default nextConfig
