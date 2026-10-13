import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The cloudflare plugin runs the server code in worker/ alongside the page,
// in development as in the build, with a local copy of the database.
export default defineConfig({
  plugins: [react(), cloudflare()],
  // The 3D view's chunk is mostly three.js (about 560 kB, 140 kB gzipped). It
  // is loaded only when a box is shown, so its size is expected.
  build: { chunkSizeWarningLimit: 600 },
})
