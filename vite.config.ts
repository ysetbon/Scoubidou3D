import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Five static pages:
//   index.html         the project site (styles in site/site.css) — root of the build
//   app/index.html     the 3D editor itself, served at /app/
//   levels/index.html  every level of every m x n twist face, at /levels/. An entry
//                      rather than a public/ file so its <link> picks up the same
//                      hashed site.css; its images are in public/levels/img/.
//   twist/index.html   the twist study's front door at /twist/ — the stable link to
//                      hand out, pointing at the write-up, the gallery and the app.
//   mxn/index.html     the MXN Continuation Lab at /mxn/, mirrored from the site it
//                      was built on (see docs/mxn-lab.md). The only React in this
//                      repo, which is why plugin-react is here; it carries its own
//                      stylesheet rather than site.css, and its engine and Python
//                      modules are static files under public/mxn/.
//
// Base is set for GitHub Pages project-site hosting (ysetbon.github.io/Scoubidou3D/).
// Override with `vite build --base=/` for root hosting.
const page = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  base: process.env.BASE_PATH ?? '/Scoubidou3D/',
  plugins: [react({ include: '**/mxn-lab/**' })],
  server: { open: true },
  build: {
    rollupOptions: {
      input: {
        site: page('index.html'),
        app: page('app/index.html'),
        levels: page('levels/index.html'),
        twist: page('twist/index.html'),
        mxn: page('mxn/index.html'),
        mxnFast: page('mxn/fast/index.html'),
        mxnRate: page('mxn/rate/index.html'),
        mxnSemi: page('mxn/semi/index.html'),
      },
    },
  },
});
