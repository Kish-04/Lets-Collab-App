/** @type {import('next').NextConfig} */
const isElectronBuild = process.env.IS_ELECTRON === 'true' && !process.env.VERCEL

const nextConfig = {
  output: isElectronBuild ? 'export' : undefined,
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
  },
  turbopack: {
    resolveAlias: {
      'monaco-editor/esm/vs/editor/editor.api.js': 'monaco-editor'
    }
  }
}

export default nextConfig
