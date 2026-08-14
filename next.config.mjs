/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.IS_ELECTRON ? 'export' : undefined,
  images: {
    unoptimized: true,
  },
  transpilePackages: ['y-monaco'],
}

export default nextConfig
