import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(import.meta.dir, '..')
const CLIENT_DIR = path.join(ROOT, 'client', 'debug')
export const PUBLIC_DIR = path.join(ROOT, 'public')

async function build(): Promise<void> {
  // Ensure output directory exists
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })

  // Build client JS bundle
  const result = await Bun.build({
    entrypoints: [path.join(CLIENT_DIR, 'index.ts')],
    outdir: PUBLIC_DIR,
    format: 'iife',
    naming: 'dashboard.js',
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  // Verify output is non-empty
  const jsOutput = path.join(PUBLIC_DIR, 'dashboard.js')
  const stat = fs.statSync(jsOutput)
  if (stat.size === 0) {
    console.error('Build produced empty dashboard.js')
    process.exit(1)
  }

  // Copy static assets
  fs.copyFileSync(path.join(CLIENT_DIR, 'dashboard.html'), path.join(PUBLIC_DIR, 'dashboard.html'))
  fs.copyFileSync(path.join(CLIENT_DIR, 'dashboard.css'), path.join(PUBLIC_DIR, 'dashboard.css'))

  console.log(`Build complete: ${PUBLIC_DIR}`)
}

await build()
