// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

function resolveOutDir(): string {
  const override = process.env['CLIENT_BUILD_OUTDIR']
  if (override === undefined || override === '') return 'public'
  return override
}

// Dev-only HTML rewriting: the four client pages ship <script src="/x.js"> +
// <link href="/x.css"> tags aimed at the public/ build artifacts. In the dev
// server those point at the source instead — a module script at the app entry
// (full Vite transform + HMR) and the three source stylesheets in the same
// tokens -> base -> app-local order the build assembles them. The CSP meta is
// relaxed with `style-src 'unsafe-inline'` because Vite's dev pipeline applies
// component CSS via injected inline <style> elements, which the production
// `default-src 'self'` policy blocks. The transcript page uses the /t.*
// artifact aliases its production server serves under.
interface DevPage {
  artifact: string
  entry: string
  localCss: string
}

const DEV_PAGES: DevPage[] = [
  { artifact: 'debug', entry: '/client/debug/index.ts', localCss: '/client/debug/debug.css' },
  { artifact: 'admin', entry: '/client/admin/index.ts', localCss: '/client/admin/admin.css' },
  { artifact: 'settings', entry: '/client/settings/index.ts', localCss: '/client/settings/settings.css' },
  { artifact: 't', entry: '/client/transcript/index.ts', localCss: '/client/transcript/transcript.css' },
]

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

function rewriteDevHtml(html: string): string {
  let rewritten = html.replace(
    /<meta(?=[^>]*http-equiv="Content-Security-Policy")[^>]*>/u,
    "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; style-src 'self' 'unsafe-inline'\" />",
  )
  for (const page of DEV_PAGES) {
    rewritten = rewritten.replace(
      new RegExp(`<script[^>]*src="/${escapeRegExp(page.artifact)}\\.js"[^>]*>\\s*</script>`, 'u'),
      `<script type="module" src="${page.entry}"></script>`,
    )
    rewritten = rewritten.replace(
      new RegExp(`<link[^>]*href="/${escapeRegExp(page.artifact)}\\.css"[^>]*>`, 'u'),
      [
        '<link rel="stylesheet" href="/client/shared/tokens.css" />',
        '<link rel="stylesheet" href="/client/shared/base.css" />',
        `<link rel="stylesheet" href="${page.localCss}" />`,
      ].join('\n    '),
    )
  }
  return rewritten
}

function devHtmlRewritePlugin(): Plugin {
  return {
    name: 'papai-dev-html-rewrite',
    apply: 'serve',
    transformIndexHtml(html): string {
      return rewriteDevHtml(html)
    },
  }
}

export default defineConfig(() => ({
  plugins: [svelte({ preprocess: vitePreprocess() }), devHtmlRewritePlugin()],
  resolve: {
    alias: {
      '@client': path.join(ROOT, 'client'),
      '@src': path.join(ROOT, 'src'),
    },
  },
  build: {
    outDir: resolveOutDir(),
    minify: false,
    emptyOutDir: false,
  },
}))
