// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ArchitectureLlm } from '../../scripts/architecture-refresh-model.js'
import {
  buildArchitectureOutputFiles,
  renderClientSurfaceDot,
  renderFocusedAreaDot,
} from '../../scripts/architecture-refresh-report.js'

const model: ArchitectureLlm = {
  scope: { includedRoots: ['src', 'client'], excludedPrefixes: ['tests/', 'scripts/'] },
  rawArtifact: 'raw/dependency-cruiser.json',
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
    ],
  },
}

describe('architecture refresh report', () => {
  test('builds stable committed output file paths', () => {
    const files = buildArchitectureOutputFiles(model)

    expect(files.map((file) => file.relativePath)).toEqual([
      'architecture-llm.json',
      'overview.md',
      'server/chat.md',
      'server/tools.md',
      'client/overview.md',
    ])
    expect(files[0]?.content).not.toContain('generatedAt')
  })

  test('renders focused area dot with neighboring dependencies', () => {
    const dot = renderFocusedAreaDot('chat', model)

    expect(dot).toContain('digraph')
    expect(dot).toContain('"chat" -> "tools"')
  })

  test('renders focused client surface dot', () => {
    const dot = renderClientSurfaceDot('settings', model)

    expect(dot).toContain('digraph')
    expect(dot).toContain('"settings" -> "settings/debug"')
  })
})
