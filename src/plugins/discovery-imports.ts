// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { SourceParser } from '../ts-ast/source-parser.js'
import { collectImports, type ImportScanResult } from './discovery-import-scan.js'

/**
 * Walks a plugin's entry graph: every source reachable from the entry point
 * through relative imports, literal dynamic imports, and `import.meta.require`.
 */
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
      throw new Error(`Bare-module imports are not allowed in plugin entry graphs: ${specifier}`)
    }
    enqueueResolvedImport(pending, current.path, pluginDir, specifier, true, deps)
  }
}

function visitPluginSource(
  result: ImportScanResult,
  pending: PendingPluginSource[],
  current: PendingPluginSource,
  pluginDir: string,
  deps: ReadPluginSourceGraphDeps,
): void {
  if (result.hasNonDeterministicImportMetaRequire) {
    throw new Error(`Unresolvable plugin import.meta.require in ${current.path}`)
  }
  addPendingRequireImports(pending, current, pluginDir, result.importMetaRequireSpecifiers, deps)
  if (current.fromRequire) return

  if (result.hasNonDeterministicDynamicImport) {
    throw new Error(`Unresolvable plugin dynamic import in ${current.path}`)
  }
  addPendingStaticImports(pending, current.path, pluginDir, result.dynamicSpecifiers, deps)
  addPendingStaticImports(pending, current.path, pluginDir, result.staticSpecifiers, deps)
}

type WalkState = {
  readonly visited: Set<string>
  readonly ordered: string[]
}

/** Claim the unvisited entries of a round, recording their arrival order. */
function admit(pending: readonly PendingPluginSource[], state: WalkState): PendingPluginSource[] {
  const admitted: PendingPluginSource[] = []
  for (const current of pending) {
    const visitKey = makePendingVisitKey(current)
    if (state.visited.has(visitKey)) continue
    state.visited.add(visitKey)
    if (!state.ordered.includes(current.path)) state.ordered.push(current.path)
    admitted.push(current)
  }
  return admitted
}

/**
 * Breadth-first by depth level rather than file: every source at one depth is
 * parsed in a single round trip, so the walk costs one exchange with `tsgo` per
 * level instead of one per file. Recursion rather than a loop keeps the awaits
 * out of iteration.
 */
async function walkPluginSources(
  parser: SourceParser,
  pending: readonly PendingPluginSource[],
  state: WalkState,
  pluginDir: string,
  deps: ReadPluginSourceGraphDeps,
  readFileSync: (path: string, encoding: 'utf-8') => string,
): Promise<void> {
  const round = admit(pending, state)
  if (round.length === 0) return

  const sources = new Map(round.map((current) => [current.path, readFileSync(current.path, 'utf-8')]))
  const parsed = await parser.parseAll(sources)

  const next: PendingPluginSource[] = []
  for (const current of round) {
    const sourceFile = parsed.get(current.path)
    if (sourceFile === undefined) throw new Error(`Unreadable plugin source ${current.path}`)
    visitPluginSource(collectImports(sourceFile), next, current, pluginDir, deps)
  }

  return walkPluginSources(parser, next, state, pluginDir, deps, readFileSync)
}

export async function readPluginSourceGraph(
  parser: SourceParser,
  entryPoint: string,
  pluginDir: string,
  deps: ReadPluginSourceGraphDeps,
  readFileSync: (path: string, encoding: 'utf-8') => string,
): Promise<string[]> {
  const state: WalkState = { visited: new Set(), ordered: [] }
  await walkPluginSources(parser, [{ path: entryPoint, fromRequire: false }], state, pluginDir, deps, readFileSync)
  return state.ordered.sort()
}
