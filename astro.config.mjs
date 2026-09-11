// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare({
    // No image transforms needed; keeps the worker small.
    imageService: 'passthrough',
  }),
  vite: {
    ssr: {
      optimizeDeps: {
        // Discovered lazily on the first request otherwise, which triggers a dep re-bundle and
        // reload that the workerd runner does not survive ("The file does not exist at .../deps_ssr/...").
        include: ['astro/assets/services/noop', 'astro/logger/console'],
      },
    },
  },
});
