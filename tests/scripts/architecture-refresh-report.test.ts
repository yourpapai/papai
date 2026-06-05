// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ArchitectureLlm } from '../../scripts/architecture-refresh-model.js'
import { buildArchitectureOutputFiles } from '../../scripts/architecture-refresh-report.js'

const model: ArchitectureLlm = {
  scope: {
    includedRoots: ['src', 'client'],
    excludedPrefixes: ['tests/', 'scripts/'],
  },
  server: {
    focusedAreaIds: ['chat', 'tools'],
    areas: [
      {
        id: 'chat',
        slug: 'chat',
        label: 'chat',
        kind: 'server',
        paths: ['src/chat/router.ts'],
        dependsOn: ['tools'],
        dependedOnBy: [],
      },
      {
        id: 'tools',
        slug: 'tools',
        label: 'tools',
        kind: 'server',
        paths: ['src/tools/tools-builder.ts'],
        dependsOn: [],
        dependedOnBy: ['chat'],
      },
      {
        id: 'shared/runtime',
        slug: 'shared-runtime',
        label: 'shared/runtime',
        kind: 'server',
        paths: ['src/index.ts'],
        dependsOn: [],
        dependedOnBy: ['settings'],
      },
    ],
  },
  client: {
    surfaces: [
      {
        id: 'settings',
        slug: 'settings',
        label: 'settings',
        kind: 'client',
        paths: ['client/settings/App.svelte'],
        dependsOn: ['settings/debug'],
        dependedOnBy: [],
      },
      {
        id: 'admin',
        slug: 'admin',
        label: 'admin',
        kind: 'client',
        paths: ['client/admin/App.svelte'],
        dependsOn: ['settings/debug'],
        dependedOnBy: [],
      },
      {
        id: 'debug',
        slug: 'debug',
        label: 'debug',
        kind: 'client',
        paths: ['client/debug/App.tsx'],
        dependsOn: [],
        dependedOnBy: ['settings', 'admin'],
      },
      {
        id: 'shared',
        slug: 'shared',
        label: 'shared',
        kind: 'client',
        paths: ['client/shared/helpers.ts'],
        dependsOn: [],
        dependedOnBy: ['settings'],
      },
    ],
  },
}

describe('architecture refresh report', () => {
  test('builds stable committed output file paths', () => {
    const files = buildArchitectureOutputFiles(model)
    const overview = files.find((file) => file.relativePath === 'overview.md')
    const clientOverview = files.find((file) => file.relativePath === 'client/overview.md')

    expect(files.map((file) => file.relativePath)).toEqual([
      'architecture-llm.json',
      'overview.md',
      'server/chat.md',
      'server/tools.md',
      'client/overview.md',
    ])
    expect(files[0]?.content).not.toContain('generatedAt')
    expect(overview?.content).toContain('chat -> tools')
    expect(overview?.content).toContain('Auxiliary Runtime Buckets')
    expect(overview?.content).toContain('shared/runtime')
    expect(overview?.content).not.toContain('Canonical Raw Graph')
    expect(overview?.content).not.toContain('raw/dependency-cruiser.json')
    expect(clientOverview?.content).toContain('settings: client/settings/App.svelte')
    expect(clientOverview?.content).toContain('admin: client/admin/App.svelte')
    expect(clientOverview?.content).toContain('debug: client/debug/App.tsx')
    expect(clientOverview?.content).toContain('Auxiliary client buckets')
    expect(clientOverview?.content).toContain('shared: client/shared/helpers.ts')
  })
})
