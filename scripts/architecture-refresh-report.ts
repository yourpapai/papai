// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ArchitectureLlm } from './architecture-refresh-model.js'

export interface ArchitectureOutputFile {
  readonly relativePath: string
  readonly content: string
}

const lines = (value: readonly string[]): string => value.join('\n')

const listOrNone = (items: readonly string[]): string =>
  items.length === 0 ? '_None._' : items.map((item) => `- ${item}`).join('\n')

const sortBySlug = <T extends { slug: string }>(items: readonly T[]): readonly T[] =>
  [...items].sort((left, right) => left.slug.localeCompare(right.slug))

const overviewForModel = (model: ArchitectureLlm): string =>
  lines([
    '# Architecture Overview',
    '',
    '## Runtime Scope',
    '',
    `- Included roots: ${model.scope.includedRoots.join(', ')}`,
    `- Excluded prefixes: ${model.scope.excludedPrefixes.join(', ')}`,
    '',
    '## Server Areas',
    '',
    ...sortBySlug(model.server.areas).map((area) => `- ${area.id} -> ${area.dependsOn.join(', ') || 'none'}`),
    '',
    '## Client Surfaces',
    '',
    ...sortBySlug(model.client.surfaces).map(
      (surface) => `- ${surface.id} -> ${surface.dependsOn.join(', ') || 'none'}`,
    ),
    '',
    '## Canonical Raw Graph',
    '',
    `- ${model.rawArtifact}`,
    '',
  ])

const serverAreaDoc = (area: ArchitectureLlm['server']['areas'][number]): string =>
  lines([
    `# ${area.id}`,
    '',
    '## Paths',
    '',
    listOrNone(area.paths),
    '',
    '## Depends On',
    '',
    listOrNone(area.dependsOn),
    '',
    '## Depended On By',
    '',
    listOrNone(area.dependedOnBy),
    '',
  ])

const clientOverviewDoc = (model: ArchitectureLlm): string =>
  lines([
    '# Client Architecture Overview',
    '',
    ...sortBySlug(model.client.surfaces).map((surface) => `- ${surface.id}: ${surface.paths.join(', ')}`),
    '',
  ])

export const renderFocusedAreaDot = (areaId: string, model: ArchitectureLlm): string => {
  const area = model.server.areas.find((candidate) => candidate.id === areaId)
  if (area === undefined) {
    throw new Error(`Unknown focused area: ${areaId}`)
  }

  const edges = area.dependsOn.map((dependencyId) => `  "${area.id}" -> "${dependencyId}";`)
  const reverseEdges = area.dependedOnBy.map((dependentId) => `  "${dependentId}" -> "${area.id}";`)

  return lines([
    'digraph focused_area {',
    '  rankdir=LR;',
    `  "${area.id}" [shape=box, style=filled, fillcolor="#d6f5de"];`,
    ...edges,
    ...reverseEdges,
    '}',
  ])
}

export const renderClientSurfaceDot = (surfaceId: string, model: ArchitectureLlm): string => {
  const surface = model.client.surfaces.find((candidate) => candidate.id === surfaceId)
  if (surface === undefined) {
    throw new Error(`Unknown client surface: ${surfaceId}`)
  }

  return lines([
    'digraph client_surface {',
    '  rankdir=LR;',
    `  "${surface.id}" [shape=box, style=filled, fillcolor="#dbeafe"];`,
    ...surface.dependsOn.map((dependencyId) => `  "${surface.id}" -> "${dependencyId}";`),
    ...surface.dependedOnBy.map((dependentId) => `  "${dependentId}" -> "${surface.id}";`),
    '}',
  ])
}

export const buildArchitectureOutputFiles = (model: ArchitectureLlm): readonly ArchitectureOutputFile[] => [
  {
    relativePath: 'architecture-llm.json',
    content: `${JSON.stringify(model, null, 2)}\n`,
  },
  {
    relativePath: 'overview.md',
    content: overviewForModel(model),
  },
  ...sortBySlug(model.server.areas).map((area) => ({
    relativePath: `server/${area.slug}.md`,
    content: serverAreaDoc(area),
  })),
  {
    relativePath: 'client/overview.md',
    content: clientOverviewDoc(model),
  },
]
