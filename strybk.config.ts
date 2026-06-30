// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import { defineConfig } from '@crvy/strybk'

const CLIENT_ROOT = path.join(process.cwd(), 'client')

export default defineConfig({
  storybookUrl: 'http://localhost:6006',
  storyGlobs: ['client/**/*.stories.svelte'],
  // Mirror each story's path under tests/visual/ as a committed .spec.ts.
  // client/settings/sections/ToolsSection.stories.svelte
  //   -> tests/visual/settings/sections/ToolsSection.spec.ts
  resolveSpecPath: ({ storyFilePath }) => {
    const rel = path.relative(CLIENT_ROOT, storyFilePath)
    return path.join('tests/visual', rel.replace(/\.stories\.svelte$/u, '.spec.ts'))
  },
})
