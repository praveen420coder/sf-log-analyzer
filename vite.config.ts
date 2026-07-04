import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
    // content-ui.js is a Manifest V3 content script injected directly via the
    // manifest ("js": ["content-ui.js"]). Such scripts must ship as a single
    // self-contained file — they aren't loaded as ES modules, so Rollup code-
    // splitting would emit chunks the content script can't load at runtime.
    // A ~500 kB single bundle is therefore expected; lift the warning ceiling.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: './index.html',
        'content-ui': './src/extension/content-ui.tsx',
        content: './src/extension/content.ts',
        background: './src/extension/background.ts',
        extractor: './src/extension/extractor.ts'
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]'
      }
    }
  }
})
