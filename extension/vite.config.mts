import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

// Builds the popup (a normal ES-module SPA, loaded via <script type="module">)
// and copies manifest.json + icons. Content scripts are built separately by
// scripts/build-content-scripts.mjs, since they must be self-contained
// classic scripts, not ES modules with shared chunks - see that file.
export default defineConfig({
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'manifest.json', dest: '.' },
        { src: 'icons', dest: '.' },
        // pdf.js's worker does the actual PDF parsing off the main thread;
        // must ship as a real file (declared in manifest.json's
        // web_accessible_resources) and be loaded via chrome.runtime.getURL()
        // - it can't be part of the content-isolated.js bundle itself.
        { src: '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', dest: 'workers' },
      ],
    }),
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, 'popup.html'),
        options: resolve(__dirname, 'options.html'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: '[name].js',
        assetFileNames: '[name].[ext]',
      },
    },
  },
});
