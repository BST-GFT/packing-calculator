import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A relative base keeps the built page working under any GitHub Pages path
// (https://<org>.github.io/<repo>/), whatever the repository is called.
export default defineConfig({
  base: './',
  plugins: [react()],
  // The 3D view's chunk is mostly three.js (about 560 kB, 140 kB gzipped). It
  // is loaded only when a box is shown, so its size is expected.
  build: { chunkSizeWarningLimit: 600 },
})
