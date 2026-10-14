import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

// The version shown on the page is the one in package.json.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

// The cloudflare plugin runs the server code in worker/ alongside the page,
// in development as in the build, with a local copy of the database.
export default defineConfig({
  plugins: [react(), cloudflare()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  // The 3D view's chunk is mostly three.js (about 560 kB, 140 kB gzipped). It
  // is loaded only when a box is shown, so its size is expected.
  build: { chunkSizeWarningLimit: 600 },
})
