// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { sveltePlugin } from './svelte-plugin.js'

const ROOT = path.resolve(import.meta.dir, '..')
const CLIENT_DIR = path.join(ROOT, 'client', 'debug')
export const PUBLIC_DIR = path.join(ROOT, 'public')

async function build(): Promise<void> {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })

  const collectedCss: string[] = []

  const result = await Bun.build({
    entrypoints: [path.join(CLIENT_DIR, 'index.ts')],
    outdir: PUBLIC_DIR,
    format: 'iife',
    naming: 'dashboard.js',
    plugins: [
      sveltePlugin({
        collectCss: (_filename, css) => {
          if (css.length > 0) collectedCss.push(css)
        },
      }),
    ],
  })

  if (!result.success) {
    for (const log of result.logs) {
      console.error(log)
    }
    process.exit(1)
  }

  const jsOutput = path.join(PUBLIC_DIR, 'dashboard.js')
  const stat = fs.statSync(jsOutput)
  if (stat.size === 0) {
    console.error('Build produced empty dashboard.js')
    process.exit(1)
  }

  fs.copyFileSync(path.join(CLIENT_DIR, 'dashboard.html'), path.join(PUBLIC_DIR, 'dashboard.html'))

  const baseCss = fs.readFileSync(path.join(CLIENT_DIR, 'dashboard.css'), 'utf8')
  const componentCss = collectedCss.join('\n')
  const finalCss = componentCss.length > 0 ? `${baseCss}\n\n/* component-scoped styles */\n${componentCss}` : baseCss
  fs.writeFileSync(path.join(PUBLIC_DIR, 'dashboard.css'), finalCss)

  console.log(`Build complete: ${PUBLIC_DIR}`)
}

await build()
