// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { build } from 'vite'
import type { InlineConfig } from 'vite'

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
  {
    entry: 'client/transcript/index.ts',
    htmlSrc: 'client/transcript/transcript.html',
    jsName: 'transcript.js',
    htmlName: 'transcript.html',
    cssName: 'transcript.css',
    baseCssPath: 'client/shared/base.css',
    localCssPath: 'client/transcript/transcript.css',
  },
]

// The root vite.config.ts supplies the svelte plugin and the @client/@src
// aliases; everything here is the per-bundle inline override. `format: 'iife'`
// already forces single-file output with dynamic imports inlined (rolldown's
// `codeSplitting: false`; setting `inlineDynamicImports` too is ignored with a
// warning). `exports: 'none'` drops the entries' source-level API exports
// (consumed from source by tests, never from the artifact): the IIFE is loaded
// as a plain script tag, so no `var name = (...)` wrapper may lead the output.
function viteInlineConfig(config: BundleConfig): InlineConfig {
  return {
    root: ROOT,
    logLevel: 'warn',
    build: {
      outDir: PUBLIC_DIR,
      minify: false,
      emptyOutDir: false,
      write: false,
      cssCodeSplit: false,
      rollupOptions: {
        input: path.join(ROOT, config.entry),
        output: {
          format: 'iife',
          entryFileNames: config.jsName,
          exports: 'none',
        },
      },
    },
  }
}

interface ViteOutput {
  js: string
  componentCss: string
}

function collectViteOutput(result: Awaited<ReturnType<typeof build>>): ViteOutput {
  const resultBundles = Array.isArray(result) ? result : [result]

  let js = ''
  let componentCss = ''
  for (const bundle of resultBundles) {
    // build() without watch never yields a watcher; the guard only narrows
    // the watcher variant out of the result union's type.
    if (!('output' in bundle)) continue
    for (const file of bundle.output) {
      if (file.type === 'chunk' && file.isEntry) {
        js = file.code
      } else if (file.type === 'asset' && file.fileName.endsWith('.css')) {
        componentCss = file.source.toString()
      }
    }
  }

  return { js, componentCss }
}

async function bundleJS(config: BundleConfig): Promise<string> {
  const result = await build(viteInlineConfig(config))
  const { js, componentCss } = collectViteOutput(result)

  if (js.length === 0) {
    console.error(`Build produced empty ${config.jsName}`)
    process.exit(1)
  }

  fs.writeFileSync(path.join(PUBLIC_DIR, config.jsName), js)

  return componentCss
}

function bundleCSS(config: BundleConfig, componentCss: string): void {
  let baseCss = ''
  if (fs.existsSync(path.join(ROOT, config.baseCssPath))) {
    baseCss = fs.readFileSync(path.join(ROOT, config.baseCssPath), 'utf8')
  }

  let localCss = ''
  if (fs.existsSync(path.join(ROOT, config.localCssPath))) {
    localCss = fs.readFileSync(path.join(ROOT, config.localCssPath), 'utf8')
  }

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
  const componentCss = await bundleJS(config)

  fs.copyFileSync(path.join(ROOT, config.htmlSrc), path.join(PUBLIC_DIR, config.htmlName))

  bundleCSS(config, componentCss)

  console.log(`Bundle complete: ${config.jsName} -> ${PUBLIC_DIR}`)
}

async function buildAll(): Promise<void> {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true })

  await Promise.all(BUNDLES.map((bundle) => buildBundle(bundle)))
}

if (import.meta.main) {
  await buildAll()
}
