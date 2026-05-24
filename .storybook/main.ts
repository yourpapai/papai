// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { StorybookConfig } from '@storybook/svelte-vite'
import { mergeConfig } from 'vite'

const ROOT = path.resolve(__dirname, '..')

const config: StorybookConfig = {
  framework: { name: '@storybook/svelte-vite', options: {} },
  stories: ['../client/**/*.stories.svelte'],
  addons: ['@storybook/addon-svelte-csf', '@storybook/addon-a11y', 'msw-storybook-addon'],
  staticDirs: ['../public'],
  typescript: { check: false },
  // The Svelte plugin is injected by @storybook/svelte-vite; here we only add
  // path aliases and widen the dev-server fs allowlist so components can import
  // transitively from ../src (zod schemas).
  viteFinal: (viteConfig) =>
    mergeConfig(viteConfig, {
      resolve: {
        alias: {
          '@client': path.join(ROOT, 'client'),
          '@src': path.join(ROOT, 'src'),
        },
      },
      server: { fs: { allow: [ROOT] } },
    }),
}

export default config
