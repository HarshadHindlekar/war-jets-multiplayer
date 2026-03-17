import type { NextConfig } from 'next'

const isGithubPages = process.env.GITHUB_ACTIONS === 'true'
const repoName = 'war-jets-multiplayer'

const nextConfig: NextConfig = {
  output: 'export',          // Static HTML export — works on GitHub Pages
  reactStrictMode: false,
  images: { unoptimized: true },
  ...(isGithubPages
    ? {
        basePath: `/${repoName}`,
        assetPrefix: `/${repoName}/`,
      }
    : {}),
  trailingSlash: true,
}

export default nextConfig
