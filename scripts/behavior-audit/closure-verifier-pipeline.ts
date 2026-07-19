// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { join } from 'node:path'

import pLimit from 'p-limit'

import {
  runClosureCheck,
  type CodeindexCandidate,
  type CodeindexResolver,
  type HintResolvers,
} from './closure-verifier.js'
import { CONCURRENCY, PROJECT_ROOT } from './config.js'
import {
  buildCommandMap,
  buildRouteMap,
  buildToolMap,
  loadCommandCatalog,
  loadRouteRegistry,
  loadToolRegistry,
} from './entry-point-maps.js'
import { loadCodeindexDeps, type RankedSearchResult } from './extract-evidence-loader.js'
import type { ConsolidatedManifest } from './incremental.js'
import { readConsolidatedFile, writeConsolidatedFile, type ConsolidatedBehavior } from './report-writer.js'

const SYMBOL_SEARCH_LIMIT = 5

export interface Phase2cDeps {
  readonly repoRoot: string
  readonly loadCommandCatalog: typeof loadCommandCatalog
  readonly loadToolRegistry: typeof loadToolRegistry
  readonly loadRouteRegistry: typeof loadRouteRegistry
  readonly loadCodeindexDeps: typeof loadCodeindexDeps
  readonly readConsolidatedFile: typeof readConsolidatedFile
  readonly writeConsolidatedFile: typeof writeConsolidatedFile
  readonly concurrency: number
  readonly log: Pick<Console, 'log' | 'warn'>
}

const defaultDeps: Phase2cDeps = {
  repoRoot: PROJECT_ROOT,
  loadCommandCatalog,
  loadToolRegistry,
  loadRouteRegistry,
  loadCodeindexDeps,
  readConsolidatedFile,
  writeConsolidatedFile,
  concurrency: CONCURRENCY,
  log: console,
}

const toCandidate = (result: RankedSearchResult): CodeindexCandidate => ({
  filePath: result.filePath,
  startLine: result.startLine,
  endLine: result.endLine,
  symbolKey: result.symbolKey,
  qualifiedName: result.qualifiedName,
  snippet: result.snippet,
})

async function loadCodeindexResolver(deps: Phase2cDeps): Promise<{
  readonly resolver: CodeindexResolver | null
  readonly close: () => void
}> {
  try {
    const loaded = await deps.loadCodeindexDeps(deps.repoRoot)
    const config = await loaded.loadCodeindexConfig({
      configPath: join(deps.repoRoot, '.codeindex.json'),
      repoRoot: deps.repoRoot,
    })
    const db = loaded.db.openDatabase(config.dbPath)
    return {
      resolver: {
        search: {
          findSymbolCandidates: (query: string): Promise<readonly CodeindexCandidate[]> =>
            Promise.resolve(loaded.search.findSymbolCandidates(db, query, SYMBOL_SEARCH_LIMIT).map(toCandidate)),
        },
      },
      close: (): void => {
        db.close()
      },
    }
  } catch (err) {
    deps.log.warn(
      `Phase 2c: codeindex unavailable; handler hints will be unresolved. ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return { resolver: null, close: (): void => undefined }
  }
}

async function verifyFeatureKey(deps: Phase2cDeps, featureKey: string, resolvers: HintResolvers): Promise<void> {
  const behaviors = await deps.readConsolidatedFile(featureKey)
  if (behaviors === null) {
    return
  }
  const result = await runClosureCheck({
    behaviors: behaviors.map((behavior) => ({
      id: behavior.id,
      entryPointHints: behavior.entryPointHints,
      userStory: behavior.userStory,
    })),
    resolvers,
  })
  const updated: readonly ConsolidatedBehavior[] = behaviors.map((behavior) => {
    const closure = result.entries.get(behavior.id)
    if (closure === undefined) {
      return behavior
    }
    return { ...behavior, closure }
  })
  await deps.writeConsolidatedFile(featureKey, updated)
}

export async function runPhase2c(
  manifest: ConsolidatedManifest,
  depsInput: Partial<Phase2cDeps> = {},
): Promise<ConsolidatedManifest> {
  const deps: Phase2cDeps = { ...defaultDeps, ...depsInput }

  const [commandCatalog, toolRegistry, routeRegistry] = await Promise.all([
    deps.loadCommandCatalog(),
    deps.loadToolRegistry(),
    deps.loadRouteRegistry(),
  ])
  const [commands, tools, routes] = [
    buildCommandMap(commandCatalog),
    buildToolMap(toolRegistry),
    buildRouteMap(routeRegistry),
  ]

  const { resolver: codeindex, close: closeCodeindex } = await loadCodeindexResolver(deps)
  const resolvers: HintResolvers = { commands, tools, routes, codeindex }
  const featureKeys = [...new Set(Object.values(manifest.entries).map((entry) => entry.featureKey))]
  const limit = pLimit(deps.concurrency)

  try {
    await Promise.all(featureKeys.map((featureKey) => limit(() => verifyFeatureKey(deps, featureKey, resolvers))))
  } finally {
    closeCodeindex()
  }

  deps.log.log(`Phase 2c complete: ${featureKeys.length} feature keys verified`)
  return manifest
}
