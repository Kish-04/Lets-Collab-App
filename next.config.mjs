/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.IS_ELECTRON ? 'export' : undefined,
  images: {
    unoptimized: true,
  },
  transpilePackages: ['y-monaco'],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      'monaco-editor/esm/vs/editor/editor.api.js': 'monaco-editor'
    }
    return config
  }
}

export default nextConfig
