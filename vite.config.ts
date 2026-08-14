import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error plain-JS server module without type declarations
import { createApp } from './server/app.mjs'

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'aquaplan-api',
      configureServer(server) {
        // Mount the same Express app the production server uses; unmatched
        // requests fall through to Vite.
        server.middlewares.use(createApp())
      },
    },
  ],
  server: { port: 5173 },
})
