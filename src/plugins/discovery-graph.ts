// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import * as fs from 'node:fs'

import {
  readLiteralDynamicImports,
  readLiteralImportMetaRequires,
  readStaticImportSpecifiers,
} from './discovery-imports.js'

type PendingPluginSource = {
  path: string
  fromRequire: boolean
}

type ReadPluginSourceGraphDeps = {
  isRelativePluginImport(specifier: string): boolean
  resolveEntryImport(fromFile: string, pluginDir: string, specifier: string): string
}

function makePendingVisitKey(current: PendingPluginSource): string {
  return `${current.path}::${current.fromRequire ? 'require' : 'import'}`
}

function readPluginDynamicImports(currentPath: string, source: string): string[] {
  try {
    return readLiteralDynamicImports(source)
  } catch {
    throw new Error(`Unresolvable plugin dynamic import in ${currentPath}`)
  }
}

function enqueueResolvedImport(
  pending: PendingPluginSource[],
  currentPath: string,
  pluginDir: string,
  specifier: string,
  fromRequire: boolean,
  deps: ReadPluginSourceGraphDeps,
): void {
  pending.push({ path: deps.resolveEntryImport(currentPath, pluginDir, specifier), fromRequire })
}

function addPendingStaticImports(
  pending: PendingPluginSource[],
  currentPath: string,
  pluginDir: string,
  specifiers: readonly string[],
  deps: ReadPluginSourceGraphDeps,
): void {
  for (const specifier of specifiers) {
    if (!deps.isRelativePluginImport(specifier)) {
      throw new Error(`Bare-module imports are not allowed in plugin entry graphs: ${specifier}`)
    }
    enqueueResolvedImport(pending, currentPath, pluginDir, specifier, false, deps)
  }
}

function addPendingRequireImports(
  pending: PendingPluginSource[],
  current: PendingPluginSource,
  pluginDir: string,
  specifiers: readonly string[],
  deps: ReadPluginSourceGraphDeps,
): void {
  for (const specifier of specifiers) {
    if (!deps.isRelativePluginImport(specifier)) {
      if (current.fromRequire) {
        throw new Error(`Bare-module imports are not allowed in plugin entry graphs: ${specifier}`)
      }
      continue
    }
    enqueueResolvedImport(pending, current.path, pluginDir, specifier, true, deps)
  }
}

export function readPluginSourceGraph(
  entryPoint: string,
  pluginDir: string,
  deps: ReadPluginSourceGraphDeps,
): string[] {
  const pending: PendingPluginSource[] = [{ path: entryPoint, fromRequire: false }]
  const visited = new Set<string>()
  const ordered: string[] = []

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined) continue

    const visitKey = makePendingVisitKey(current)
    if (visited.has(visitKey)) continue

    visited.add(visitKey)
    if (!ordered.includes(current.path)) ordered.push(current.path)

    const source = fs.readFileSync(current.path, 'utf-8')
    addPendingStaticImports(pending, current.path, pluginDir, readPluginDynamicImports(current.path, source), deps)
    addPendingRequireImports(pending, current, pluginDir, readLiteralImportMetaRequires(source), deps)
    addPendingStaticImports(pending, current.path, pluginDir, readStaticImportSpecifiers(source), deps)
  }

  return ordered.sort()
}
