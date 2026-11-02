// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import preact from '@astrojs/preact';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://tools.vinhmdev.com',
  output: 'static',
  integrations: [sitemap(), preact({ compat: true })],
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
    worker: {
      format: 'es',
    },
    optimizeDeps: {
      // Force re-optimize on each dev server start to avoid stale dep hash
      // mismatches (504 errors) when many new packages are added at once.
      force: true,
    },
  },
});