// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import type { StorybookConfig } from '@storybook/svelte-vite'
import { mergeConfig } from 'vite'

// Storybook 10 evaluates main.ts as an ES module, so __dirname is unavailable;
// derive it from import.meta.url.
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const config: StorybookConfig = {
  // docgen is disabled: its plugin chokes parsing .stories.svelte module
  // scripts, and we don't ship autodocs in this phase.
  framework: { name: '@storybook/svelte-vite', options: { docgen: false } },
  stories: ['../client/**/*.stories.svelte'],
  addons: ['@storybook/addon-svelte-csf', '@storybook/addon-a11y', 'msw-storybook-addon'],
  staticDirs: ['../public'],
  typescript: { check: false },
  // The root vite.config.ts now registers @sveltejs/vite-plugin-svelte (with
  // vitePreprocess for `lang="ts"`), and @storybook/builder-vite loads it, so
  // no splice is needed here — registering svelte() again double-compiles the
  // stories and breaks the build. The root config's plugins also load ahead
  // of storybook's own, which keeps @storybook/addon-svelte-csf's transform
  // seeing compiled JS (vite-plugin-svelte v6 splits preprocess/compile into
  // separate plugins). Widen the fs allowlist so components can import
  // transitively from ../src (zod schemas).
  viteFinal: (viteConfig) => {
    return mergeConfig(viteConfig, {
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
