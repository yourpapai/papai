// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  CLIENT_SURFACE_IDS,
  EXCLUDED_PREFIXES,
  FOCUSED_SERVER_AREA_IDS,
  INCLUDED_ROOTS,
  clientSurfaceForPath,
  isArchitectureRuntimePath,
  serverAreaForPath,
  slugForArea,
} from './architecture-refresh-config.js'
import { architectureLlmSchema, type ArchitectureLlm } from './architecture-refresh-model.js'

type FocusedServerAreaId = (typeof FOCUSED_SERVER_AREA_IDS)[number]
type FocusedClientSurfaceId = (typeof CLIENT_SURFACE_IDS)[number]

type RawCruiseDependency = {
  resolved?: string
  module?: string
}
type RawCruiseModule = {
  source: string
  dependencies?: readonly RawCruiseDependency[]
}
type RawCruiseResult = {
  modules: readonly RawCruiseModule[]
  summary?: unknown
}

type AreaAccumulator = Readonly<{
  id: string
  slug: string
  label: string
  kind: 'server' | 'client'
  paths: Set<string>
  dependsOn: Set<string>
  dependedOnBy: Set<string>
}>

const moduleSource = (module: RawCruiseModule): string => module.source.replaceAll('\\', '/')

const dependencyTarget = (dependency: RawCruiseDependency): string | null => {
  const candidate = dependency.resolved ?? dependency.module
  if (typeof candidate !== 'string') {
    return null
  }

  return candidate.replaceAll('\\', '/')
}

const createArea = (id: string, kind: 'server' | 'client'): AreaAccumulator => ({
  id,
  slug: slugForArea(id),
  label: id,
  kind,
  paths: new Set<string>(),
  dependsOn: new Set<string>(),
  dependedOnBy: new Set<string>(),
})

const isFocusedServerArea = (areaId: string | null): areaId is FocusedServerAreaId =>
  areaId !== null && FOCUSED_SERVER_AREA_IDS.some((focusedAreaId) => focusedAreaId === areaId)

const isFocusedClientSurface = (surfaceId: string | null): surfaceId is FocusedClientSurfaceId =>
  surfaceId !== null && CLIENT_SURFACE_IDS.some((clientSurfaceId) => clientSurfaceId === surfaceId)

const resolveReducedArea = (
  relativePath: string,
): { id: FocusedServerAreaId; kind: 'server' } | { id: FocusedClientSurfaceId; kind: 'client' } => {
  const serverArea = serverAreaForPath(relativePath)
  if (isFocusedServerArea(serverArea)) {
    return { id: serverArea, kind: 'server' }
  }

  const clientSurface = clientSurfaceForPath(relativePath)
  if (isFocusedClientSurface(clientSurface)) {
    return { id: clientSurface, kind: 'client' }
  }

  throw new Error(`Uncategorized runtime path: ${relativePath}`)
}

const serializeArea = (area: AreaAccumulator): ArchitectureLlm['server']['areas'][number] => ({
  id: area.id,
  slug: area.slug,
  label: area.label,
  kind: area.kind,
  paths: [...area.paths].sort(),
  dependsOn: [...area.dependsOn].sort(),
  dependedOnBy: [...area.dependedOnBy].sort(),
})

export const normalizeArchitectureGraph = (raw: RawCruiseResult): ArchitectureLlm => {
  const serverAreas = new Map(FOCUSED_SERVER_AREA_IDS.map((id) => [id, createArea(id, 'server')]))
  const clientSurfaces = new Map(CLIENT_SURFACE_IDS.map((id) => [id, createArea(id, 'client')]))

  for (const module of raw.modules) {
    const source = moduleSource(module)
    if (!isArchitectureRuntimePath(source)) {
      continue
    }

    const owner = resolveReducedArea(source)
    const ownerArea = owner.kind === 'server' ? serverAreas.get(owner.id)! : clientSurfaces.get(owner.id)!
    ownerArea.paths.add(source)

    for (const dependency of module.dependencies ?? []) {
      const target = dependencyTarget(dependency)
      if (target === null || !isArchitectureRuntimePath(target)) {
        continue
      }

      const targetArea = resolveReducedArea(target)
      if (targetArea.id === ownerArea.id) {
        continue
      }

      ownerArea.dependsOn.add(targetArea.id)

      const dependentArea =
        targetArea.kind === 'server' ? serverAreas.get(targetArea.id)! : clientSurfaces.get(targetArea.id)!
      dependentArea.dependedOnBy.add(ownerArea.id)
    }
  }

  return architectureLlmSchema.parse({
    scope: {
      includedRoots: [...INCLUDED_ROOTS],
      excludedPrefixes: [...EXCLUDED_PREFIXES],
    },
    rawArtifact: 'raw/dependency-cruiser.json',
    server: {
      focusedAreaIds: [...FOCUSED_SERVER_AREA_IDS],
      areas: [...serverAreas.values()].map(serializeArea).filter((area) => area.paths.length > 0),
    },
    client: {
      surfaces: [...clientSurfaces.values()].map(serializeArea).filter((surface) => surface.paths.length > 0),
    },
  })
}
