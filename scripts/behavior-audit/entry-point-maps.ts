// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface CommandCatalogEntry {
  readonly name: string
  readonly description: string
}

export type CommandCatalogFn = () => readonly CommandCatalogEntry[]
export type ToolRegistryFn = () => readonly string[] | undefined
export type RouteRegistryFn = () => readonly string[] | undefined

function nameVariants(name: string): readonly string[] {
  return [name, name.startsWith('/') ? name.slice(1) : `/${name}`]
}

export function buildCommandMap(catalog: CommandCatalogFn): ReadonlySet<string> {
  const entries = catalog()
  const out = new Set<string>()
  for (const entry of entries) {
    for (const variant of nameVariants(entry.name)) out.add(variant)
  }
  return out
}

export function buildToolMap(registry: ToolRegistryFn): ReadonlySet<string> {
  const names = registry() ?? []
  return new Set(names)
}

export function buildRouteMap(registry: RouteRegistryFn): ReadonlySet<string> {
  const paths = registry() ?? []
  return new Set(paths)
}

export async function loadCommandCatalog(): Promise<CommandCatalogFn> {
  try {
    const mod = await import('../../src/commands/index.js')
    if (typeof mod.listCommandCatalogEntries === 'function') {
      return mod.listCommandCatalogEntries as CommandCatalogFn
    }
  } catch {
    // fall through
  }
  return () => []
}

export async function loadToolRegistry(): Promise<ToolRegistryFn> {
  try {
    const mod = await import('../../src/tools/index.js')
    if (typeof mod.listToolNames === 'function') {
      return mod.listToolNames as ToolRegistryFn
    }
  } catch {
    // fall through
  }
  return () => undefined
}

export async function loadRouteRegistry(): Promise<RouteRegistryFn> {
  try {
    const mod = await import('../../src/debug/server.js')
    if (typeof mod.listRoutes === 'function') {
      return mod.listRoutes as RouteRegistryFn
    }
  } catch {
    // fall through
  }
  return () => undefined
}
