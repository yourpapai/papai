// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

const ROOT = path.dirname(fileURLToPath(import.meta.url))

function resolveOutDir(): string {
  const override = process.env['CLIENT_BUILD_OUTDIR']
  if (override === undefined || override === '') return 'public'
  return override
}

export default defineConfig(() => ({
  plugins: [svelte({ preprocess: vitePreprocess() })],
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
