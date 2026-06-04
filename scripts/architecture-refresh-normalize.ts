// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import {
  CLIENT_SURFACE_IDS,
  EXCLUDED_PREFIXES,
  FOCUSED_SERVER_AREA_IDS,
  INCLUDED_ROOTS,
  RUNTIME_CLIENT_SURFACE_IDS,
  RUNTIME_SERVER_AREA_IDS,
  clientSurfaceForPath,
  isArchitectureRuntimePath,
  serverAreaForPath,
  slugForArea,
} from './architecture-refresh-config.js'
import { architectureLlmSchema, type ArchitectureLlm } from './architecture-refresh-model.js'

type RuntimeServerAreaId = (typeof RUNTIME_SERVER_AREA_IDS)[number]
type RuntimeClientSurfaceId = (typeof RUNTIME_CLIENT_SURFACE_IDS)[number]

const KNOWN_SHARED_SERVER_RUNTIME_PREFIXES = [
  'src/commands/',
  'src/config-editor/',
  'src/dashboard-auth/',
  'src/db/',
  'src/group-settings/',
  'src/message-cache/',
  'src/types/',
  'src/utils/',
] as const

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

type AreaMaps = Readonly<{
  serverAreas: Map<string, AreaAccumulator>
  clientSurfaces: Map<string, AreaAccumulator>
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

const isRuntimeServerArea = (areaId: string | null): areaId is RuntimeServerAreaId =>
  areaId !== null && RUNTIME_SERVER_AREA_IDS.some((runtimeAreaId) => runtimeAreaId === areaId)

const isRuntimeClientSurface = (surfaceId: string | null): surfaceId is RuntimeClientSurfaceId =>
  surfaceId !== null && RUNTIME_CLIENT_SURFACE_IDS.some((runtimeSurfaceId) => runtimeSurfaceId === surfaceId)

const isKnownSharedServerRuntimePath = (relativePath: string): boolean =>
  /^src\/[^/]+\.[^/]+$/u.test(relativePath) ||
  KNOWN_SHARED_SERVER_RUNTIME_PREFIXES.some((prefix) => relativePath.startsWith(prefix))

const resolveReducedArea = (
  relativePath: string,
): { id: RuntimeServerAreaId; kind: 'server' } | { id: RuntimeClientSurfaceId; kind: 'client' } => {
  const serverArea = serverAreaForPath(relativePath)
  if (
    isRuntimeServerArea(serverArea) &&
    (serverArea !== 'shared/runtime' || isKnownSharedServerRuntimePath(relativePath))
  ) {
    return { id: serverArea, kind: 'server' }
  }

  const clientSurface = clientSurfaceForPath(relativePath)
  if (isRuntimeClientSurface(clientSurface)) {
    return { id: clientSurface, kind: 'client' }
  }

  throw new Error(`Uncategorized runtime path: ${relativePath}`)
}

const getOrCreateArea = (
  areas: Map<string, AreaAccumulator>,
  id: string,
  kind: 'server' | 'client',
): AreaAccumulator => {
  const existingArea = areas.get(id)
  if (existingArea) {
    return existingArea
  }

  const area = createArea(id, kind)
  areas.set(id, area)
  return area
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

const getArea = (maps: AreaMaps, reducedArea: ReturnType<typeof resolveReducedArea>): AreaAccumulator =>
  reducedArea.kind === 'server'
    ? getOrCreateArea(maps.serverAreas, reducedArea.id, 'server')
    : getOrCreateArea(maps.clientSurfaces, reducedArea.id, 'client')

const collectModuleDependencies = (module: RawCruiseModule, maps: AreaMaps): void => {
  const source = moduleSource(module)
  if (!isArchitectureRuntimePath(source)) {
    return
  }

  const ownerArea = getArea(maps, resolveReducedArea(source))
  ownerArea.paths.add(source)

  for (const dependency of module.dependencies ?? []) {
    const target = dependencyTarget(dependency)
    if (target === null || !isArchitectureRuntimePath(target)) {
      continue
    }

    const targetArea = getArea(maps, resolveReducedArea(target))
    if (targetArea.id === ownerArea.id) {
      continue
    }

    ownerArea.dependsOn.add(targetArea.id)
    targetArea.dependedOnBy.add(ownerArea.id)
  }
}

export const normalizeArchitectureGraph = (raw: RawCruiseResult): ArchitectureLlm => {
  const serverAreas = new Map(FOCUSED_SERVER_AREA_IDS.map((id) => [id, createArea(id, 'server')]))
  const clientSurfaces = new Map(CLIENT_SURFACE_IDS.map((id) => [id, createArea(id, 'client')]))
  const maps = { serverAreas, clientSurfaces }

  for (const module of raw.modules) {
    collectModuleDependencies(module, maps)
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
