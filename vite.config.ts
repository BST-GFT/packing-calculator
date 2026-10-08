import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A relative base keeps the built page working under any GitHub Pages path
// (https://<org>.github.io/<repo>/), whatever the repository is called.
export default defineConfig({
  base: './',
  plugins: [react()],
})
