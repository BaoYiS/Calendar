/** Production entry: serves the built frontend from dist/ plus the API. */
import express from 'express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const dist = path.join(root, 'dist')
const port = Number(process.env.PORT ?? 8787)

const app = express()
app.use(createApp())
app.use(express.static(dist))
app.use((req, res) => res.sendFile(path.join(dist, 'index.html')))

app.listen(port, () => {
  console.log(`AquaPlan running at http://localhost:${port}`)
})
