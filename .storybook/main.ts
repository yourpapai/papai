// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { StorybookConfig } from '@storybook/svelte-vite'
import { mergeConfig } from 'vite'

const ROOT = path.resolve(__dirname, '..')

const config: StorybookConfig = {
  // docgen is disabled: its plugin chokes parsing .stories.svelte module
  // scripts, and we don't ship autodocs in this phase.
  framework: { name: '@storybook/svelte-vite', options: { docgen: false } },
  stories: ['../client/**/*.stories.svelte'],
  addons: ['@storybook/addon-svelte-csf', '@storybook/addon-a11y', 'msw-storybook-addon'],
  staticDirs: ['../public'],
  typescript: { check: false },
  // @storybook/svelte-vite does NOT inject vite-plugin-svelte — it expects the
  // project's Vite config to provide it, and this repo has no root vite.config
  // (production builds via Bun). So we add svelte() here (with vitePreprocess
  // for `lang="ts"`); addon-svelte-csf's enforce:'post' transform then sees the
  // compiled output. The plugin is imported dynamically because it is ESM-only
  // and main.ts is evaluated as CJS. Also widen the fs allowlist so components
  // can import transitively from ../src (zod schemas).
  viteFinal: async (viteConfig) => {
    const { svelte, vitePreprocess } = await import('@sveltejs/vite-plugin-svelte')
    return mergeConfig(viteConfig, {
      plugins: [svelte({ preprocess: vitePreprocess() })],
      resolve: {
        alias: {
          '@client': path.join(ROOT, 'client'),
          '@src': path.join(ROOT, 'src'),
        },
      },
      server: { fs: { allow: [ROOT] } },
    })
  },
}

export default config
