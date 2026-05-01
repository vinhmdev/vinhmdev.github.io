// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://utils.vinhmdev.com',
  integrations: [sitemap()],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      // Force re-optimize on each dev server start to avoid stale dep hash
      // mismatches (504 errors) when many new packages are added at once.
      force: true,
    },
  },
});