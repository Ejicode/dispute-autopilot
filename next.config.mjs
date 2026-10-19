/** @type {import('next').NextConfig} */
const nextConfig = {
  // The Go backend serves the statically exported UI and owns every /api/* route.
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
