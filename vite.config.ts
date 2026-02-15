import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  publicDir: 'public',
  build: {
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
