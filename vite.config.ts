import { defineConfig } from 'vite';

// Base is set for GitHub Pages project-site hosting (ysetbon.github.io/Scoubidou3D/).
// Override with `vite build --base=/` for root hosting.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/Scoubidou3D/',
  server: { open: true },
});
