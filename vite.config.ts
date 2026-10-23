import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'alasas-release-metadata',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'release.json',
          source: JSON.stringify({
            commitSha: process.env.VITE_RELEASE_COMMIT_SHA || process.env.GITHUB_SHA || 'local',
            environment: process.env.VITE_RELEASE_ENVIRONMENT || mode,
            appVersion: process.env.VITE_APP_VERSION || '1.8',
            builtAt: process.env.VITE_BUILD_TIME || new Date().toISOString(),
          }, null, 2) + '\n',
        })
      },
    },
  ],
  base: process.env.VITE_BASE_PATH || (mode === 'pages' ? '/gym/' : '/'),
  build: {
    rollupOptions: {
      input: {
        main: 'index.html',
        admin: 'admin/index.html',
      },
    },
    assetsDir: 'assets',
  },
}))
