// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://utils.vinhmdev.com',
  output: 'static',
  integrations: [sitemap()],
  // Prefetch links only when they enter the viewport — cheap network usage,
  // noticeably snappier nav between the two tool pages.
  prefetch: {
    prefetchAll: false,
    defaultStrategy: 'viewport',
  },
  build: {
    // Inline small stylesheets to skip a render-blocking request.
    inlineStylesheets: 'auto',
  },
  compressHTML: true,
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      // Force re-optimize on each dev server start to avoid stale dep hash
      // mismatches (504 errors) when many new packages are added at once.
      force: true,
    },
  },
});