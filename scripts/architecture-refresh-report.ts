// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clientSurfaceIds } from './architecture-refresh-model.js'
import type { ArchitectureLlm } from './architecture-refresh-model.js'

export interface ArchitectureOutputFile {
  readonly relativePath: string
  readonly content: string
}

const GENERATED_MARKDOWN_LICENSE_HEADER = [
  '<!--',
  'SPDX-License-Identifier: BUSL-1.1',
  'Copyright (c) 2026 Dmitriy Lazarev',
  'Use of this software is governed by the Business Source License 1.1.',
  'See LICENSE in the project root for details.',
  '-->',
  '',
].join('\n')

const lines = (value: readonly string[]): string => value.join('\n')

const withGeneratedMarkdownLicenseHeader = (content: string): string => `${GENERATED_MARKDOWN_LICENSE_HEADER}${content}`

const listOrNone = (items: readonly string[]): string =>
  items.length === 0 ? '_None._' : items.map((item) => `- ${item}`).join('\n')

const sortBySlug = <T extends { slug: string }>(items: readonly T[]): readonly T[] =>
  [...items].sort((left, right) => left.slug.localeCompare(right.slug))

const committedServerAreas = (model: ArchitectureLlm): readonly ArchitectureLlm['server']['areas'][number][] => {
  const focusedAreaIds = new Set(model.server.focusedAreaIds)
  return sortBySlug(model.server.areas.filter((area) => focusedAreaIds.has(area.id)))
}

const committedClientSurfaces = (model: ArchitectureLlm): readonly ArchitectureLlm['client']['surfaces'][number][] => {
  const committedSurfaceIds = new Set<string>(clientSurfaceIds)
  return sortBySlug(model.client.surfaces.filter((surface) => committedSurfaceIds.has(surface.id)))
}

const auxiliaryServerAreas = (model: ArchitectureLlm): readonly ArchitectureLlm['server']['areas'][number][] => {
  const focusedAreaIds = new Set(model.server.focusedAreaIds)
  return sortBySlug(model.server.areas.filter((area) => !focusedAreaIds.has(area.id)))
}

const auxiliaryClientSurfaces = (model: ArchitectureLlm): readonly ArchitectureLlm['client']['surfaces'][number][] => {
  const committedSurfaceIds = new Set<string>(clientSurfaceIds)
  return sortBySlug(model.client.surfaces.filter((surface) => !committedSurfaceIds.has(surface.id)))
}

const overviewForModel = (
  serverAreas: readonly ArchitectureLlm['server']['areas'][number][],
  clientSurfaces: readonly ArchitectureLlm['client']['surfaces'][number][],
  auxiliaryAreas: readonly ArchitectureLlm['server']['areas'][number][],
  auxiliarySurfaces: readonly ArchitectureLlm['client']['surfaces'][number][],
  model: ArchitectureLlm,
): string =>
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
    ...serverAreas.map((area) => `- ${area.id} -> ${area.dependsOn.join(', ') || 'none'}`),
    '',
    '## Client Surfaces',
    '',
    ...clientSurfaces.map((surface) => `- ${surface.id} -> ${surface.dependsOn.join(', ') || 'none'}`),
    '',
    '## Auxiliary Runtime Buckets',
    '',
    ...auxiliaryAreas.map((area) => `- ${area.id} -> ${area.dependsOn.join(', ') || 'none'}`),
    ...auxiliarySurfaces.map((surface) => `- ${surface.id} -> ${surface.dependsOn.join(', ') || 'none'}`),
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

const clientOverviewDoc = (
  surfaces: readonly ArchitectureLlm['client']['surfaces'][number][],
  auxiliarySurfaces: readonly ArchitectureLlm['client']['surfaces'][number][],
): string =>
  lines([
    '# Client Architecture Overview',
    '',
    ...surfaces.map((surface) => `- ${surface.id}: ${surface.paths.join(', ')}`),
    '',
    '## Auxiliary client buckets',
    '',
    ...auxiliarySurfaces.map((surface) => `- ${surface.id}: ${surface.paths.join(', ')}`),
    '',
  ])

export const buildArchitectureOutputFiles = (model: ArchitectureLlm): readonly ArchitectureOutputFile[] => {
  const serverAreas = committedServerAreas(model)
  const clientSurfaces = committedClientSurfaces(model)
  const auxiliaryAreas = auxiliaryServerAreas(model)
  const auxiliarySurfaces = auxiliaryClientSurfaces(model)

  return [
    {
      relativePath: 'architecture-llm.json',
      content: `${JSON.stringify(model, null, 2)}\n`,
    },
    {
      relativePath: 'overview.md',
      content: withGeneratedMarkdownLicenseHeader(
        overviewForModel(serverAreas, clientSurfaces, auxiliaryAreas, auxiliarySurfaces, model),
      ),
    },
    ...serverAreas.map((area) => ({
      relativePath: `server/${area.slug}.md`,
      content: withGeneratedMarkdownLicenseHeader(serverAreaDoc(area)),
    })),
    {
      relativePath: 'client/overview.md',
      content: withGeneratedMarkdownLicenseHeader(clientOverviewDoc(clientSurfaces, auxiliarySurfaces)),
    },
  ]
}
