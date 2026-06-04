// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { normalizeArchitectureGraph } from '../../scripts/architecture-refresh-normalize.js'

const rawGraph = {
  modules: [
    {
      source: 'src/chat/router.ts',
      dependencies: [{ resolved: 'src/tools/tools-builder.ts' }],
    },
    {
      source: 'src/tools/tools-builder.ts',
      dependencies: [{ resolved: 'src/providers/index.ts' }],
    },
    {
      source: 'src/providers/index.ts',
      dependencies: [],
    },
    {
      source: 'client/settings/App.svelte',
      dependencies: [{ resolved: 'src/settings/session.ts' }],
    },
    {
      source: 'src/settings/session.ts',
      dependencies: [],
    },
  ],
  summary: { totalCruised: 5 },
} as const

describe('normalizeArchitectureGraph', () => {
  test('collapses file-level modules into server and client area edges', () => {
    const model = normalizeArchitectureGraph(rawGraph)

    expect(model.rawArtifact).toBe('raw/dependency-cruiser.json')
    expect(model.server.areas.find((area) => area.id === 'chat')?.dependsOn).toEqual(['tools'])
    expect(model.server.areas.find((area) => area.id === 'tools')?.dependsOn).toEqual(['providers/plugins'])
    expect(model.client.surfaces.find((surface) => surface.id === 'settings')?.dependsOn).toEqual(['settings/debug'])
  })

  test('fails on uncategorized included runtime paths', () => {
    expect(() =>
      normalizeArchitectureGraph({
        modules: [{ source: 'src/unknown/new-runtime.ts', dependencies: [] }],
        summary: { totalCruised: 1 },
      }),
    ).toThrow('Uncategorized runtime path: src/unknown/new-runtime.ts')
  })
})
