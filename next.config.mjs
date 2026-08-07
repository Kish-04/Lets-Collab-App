/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.VERCEL ? undefined : 'export',
  images: {
    unoptimized: true,
  },
}

export default nextConfig
