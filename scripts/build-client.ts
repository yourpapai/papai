// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { sveltePlugin } from './svelte-plugin.js'

const ROOT = path.resolve(import.meta.dir, '..')
export const PUBLIC_DIR = path.join(ROOT, 'public')

export interface BundleConfig {
  entry: string
  htmlSrc: string
  jsName: string
  htmlName: string
  cssName: string
  baseCssPath: string
  localCssPath: string
}

const BUNDLES: BundleConfig[] = [
  {
    entry: 'client/debug/index.ts',
    htmlSrc: 'client/debug/dashboard.html',
    jsName: 'dashboard.js',
    htmlName: 'dashboard.html',
    cssName: 'dashboard.css',
    baseCssPath: 'client/shared/base.css',
    localCssPath: 'client/debug/dashboard.css',
  },
]

async function bundleJS(config: BundleConfig, collectedCss: string[]): Promise<void> {
  const result = await Bun.build({
    entrypoints: [path.join(ROOT, config.entry)],
    outdir: PUBLIC_DIR,
    format: 'iife',
    naming: config.jsName,
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

  const jsOutput = path.join(PUBLIC_DIR, config.jsName)
  const stat = fs.statSync(jsOutput)
  if (stat.size === 0) {
    console.error(`Build produced empty ${config.jsName}`)
    process.exit(1)
  }
}

function bundleCSS(config: BundleConfig, collectedCss: string[]): void {
  let baseCss = ''
  if (fs.existsSync(path.join(ROOT, config.baseCssPath))) {
    baseCss = fs.readFileSync(path.join(ROOT, config.baseCssPath), 'utf8')
  }

  let localCss = ''
  if (fs.existsSync(path.join(ROOT, config.localCssPath))) {
    localCss = fs.readFileSync(path.join(ROOT, config.localCssPath), 'utf8')
  }

  const componentCss = collectedCss.join('\n')

  const cssParts = []
  if (baseCss) cssParts.push(baseCss)
  if (localCss) cssParts.push(localCss)
  if (componentCss.length > 0) {
    cssParts.push(`/* component-scoped styles */\n${componentCss}`)
  }

  const finalCss = cssParts.join('\n\n')
  fs.writeFileSync(path.join(PUBLIC_DIR, config.cssName), finalCss)
}

export async function buildBundle(config: BundleConfig): Promise<void> {
  const collectedCss: string[] = []

  await bundleJS(config, collectedCss)

  fs.copyFileSync(path.join(ROOT, config.htmlSrc), path.join(PUBLIC_DIR, config.htmlName))

  bundleCSS(config, collectedCss)

  console.log(`Bundle complete: ${config.jsName} -> ${PUBLIC_DIR}`)
}

async function buildAll(): Promise<void> {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })

  await Promise.all(BUNDLES.map(buildBundle))
}

await buildAll()
