import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Two static pages:
//   index.html      the project site (styles in site/site.css) — root of the build
//   app/index.html  the 3D editor itself, served at /app/
//
// Base is set for GitHub Pages project-site hosting (ysetbon.github.io/Scoubidou3D/).
// Override with `vite build --base=/` for root hosting.
const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: process.env.BASE_PATH ?? '/Scoubidou3D/',
  server: { open: true },
  build: {
    rollupOptions: {
      input: { site: page('index.html'), app: page('app/index.html') },
    },
  },
});
