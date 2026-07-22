/** @type {import('next').NextConfig} */
const backendUrl = (process.env.BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:3001').replace(/\/$/, '')

const nextConfig = {
  output: 'export',
  images: {
    unoptimized: true,
  },
}

export default nextConfig
