// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { sveltePlugin } from './svelte-plugin.js'

const ROOT = path.resolve(import.meta.dir, '..')

/**
 * Output directory for client bundles. `CLIENT_BUILD_OUTDIR` overrides the
 * default `public/` so tests can build into a temp dir without touching the
 * bundles other test files serve.
 */
function resolveOutDir(): string {
  const override = process.env['CLIENT_BUILD_OUTDIR']
  if (override === undefined || override === '') {
    return path.join(ROOT, 'public')
  }
  return path.resolve(override)
}

export const PUBLIC_DIR = resolveOutDir()

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
    htmlSrc: 'client/debug/debug.html',
    jsName: 'debug.js',
    htmlName: 'debug.html',
    cssName: 'debug.css',
    baseCssPath: 'client/shared/base.css',
    localCssPath: 'client/debug/debug.css',
  },
  {
    entry: 'client/admin/index.ts',
    htmlSrc: 'client/admin/admin.html',
    jsName: 'admin.js',
    htmlName: 'admin.html',
    cssName: 'admin.css',
    baseCssPath: 'client/shared/base.css',
    localCssPath: 'client/admin/admin.css',
  },
  {
    entry: 'client/settings/index.ts',
    htmlSrc: 'client/settings/settings.html',
    jsName: 'settings.js',
    htmlName: 'settings.html',
    cssName: 'settings.css',
    baseCssPath: 'client/shared/base.css',
    localCssPath: 'client/settings/settings.css',
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

  const tokensCss = fs.readFileSync(path.join(ROOT, 'client/shared/tokens.css'), 'utf8')
  const cssParts = [tokensCss]
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

  await Promise.all(BUNDLES.map((bundle) => buildBundle(bundle)))
}

if (import.meta.main) {
  await buildAll()
}
