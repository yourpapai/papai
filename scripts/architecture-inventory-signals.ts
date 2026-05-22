// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Database } from 'bun:sqlite'

import type { PieceRecord, PieceSignal } from './architecture-inventory-model.js'

export interface CodeindexSummary {
  readonly indexedFiles: ReadonlySet<string>
  readonly referenceCountsByFile: Readonly<Record<string, number>>
}

export interface CollectSignalsInput {
  readonly piece: PieceRecord
  readonly codeindexSummary: Readonly<CodeindexSummary>
  readonly providerCapabilities: readonly string[]
  readonly toolKeys: readonly string[]
}

const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)]

const uniqueSignals = (signals: readonly PieceSignal[]): readonly PieceSignal[] => [
  ...signals
    .reduce((accumulator, signal) => {
      const existing = accumulator.get(signal.name)
      if (existing === undefined) {
        accumulator.set(signal.name, signal)
        return accumulator
      }

      accumulator.set(signal.name, {
        ...existing,
        evidence: uniqueStrings([...existing.evidence, ...signal.evidence]),
      })
      return accumulator
    }, new Map<PieceSignal['name'], PieceSignal>())
    .values(),
]

const nonEmptySignal = (name: PieceSignal['name'], evidence: readonly string[]): readonly PieceSignal[] =>
  evidence.length === 0 ? [] : [{ name, evidence }]

const lower = (value: string): string => value.toLowerCase()

const isHistoricalDocPath = (docPath: string): boolean => {
  if (docPath.startsWith('docs/archive/')) {
    return true
  }

  return docPath.startsWith('docs/superpowers/remaining/')
}

const onlyHistoricalDocs = (docs: readonly string[]): boolean =>
  docs.length > 0 && docs.every((docPath) => isHistoricalDocPath(docPath))

const onlyPrefixedPaths = (paths: readonly string[], prefix: string): boolean =>
  paths.length > 0 && paths.every((path) => path.startsWith(prefix))

const ownedPathsFor = (piece: PieceRecord): readonly string[] =>
  uniqueStrings([...piece.primaryPaths, ...piece.secondaryPaths])

const pathMatchesOwnedPath = (ownedPath: string, indexedFilePath: string): boolean => {
  if (indexedFilePath === ownedPath) {
    return true
  }

  return indexedFilePath.startsWith(`${ownedPath}/`)
}

const fileIsOwnedByPiece = (piece: PieceRecord, indexedFilePath: string): boolean =>
  ownedPathsFor(piece).some((ownedPath) => pathMatchesOwnedPath(ownedPath, indexedFilePath))

const totalReferenceCount = (piece: PieceRecord, summary: Readonly<CodeindexSummary>): number =>
  [...summary.indexedFiles].reduce((total, indexedFilePath) => {
    if (!fileIsOwnedByPiece(piece, indexedFilePath)) {
      return total
    }

    const referenceCount = summary.referenceCountsByFile[indexedFilePath]
    if (referenceCount === undefined) {
      return total
    }

    return total + referenceCount
  }, 0)

const isRuntimeBackedPiece = (piece: PieceRecord): boolean => {
  if (piece.type === 'runtime-subsystem') {
    return true
  }

  return piece.type === 'product-feature'
}

const isScriptBackedPiece = (piece: PieceRecord): boolean => {
  if (piece.type === 'analysis-tool') {
    return true
  }

  return piece.type === 'developer-workflow'
}

const appearsBenchmarkOnly = (piece: PieceRecord): boolean => {
  if (piece.tags.includes('benchmark')) {
    return true
  }

  if (piece.primaryPaths.length === 0) {
    return false
  }

  return piece.primaryPaths.every((path) => path.includes('benchmark'))
}

const appearsAuditOnly = (piece: PieceRecord): boolean => {
  if (piece.tags.includes('audit')) {
    return true
  }

  if (piece.primaryPaths.length === 0) {
    return false
  }

  return piece.primaryPaths.every((path) => path.includes('behavior-audit'))
}

const CAPABILITY_TOOL_KEYS: Readonly<Record<string, readonly string[]>> = {
  'tasks.watchers': ['list_watchers', 'add_watcher', 'remove_watcher'],
  'tasks.votes': ['add_vote', 'remove_vote'],
  'tasks.visibility': ['set_visibility'],
  'tasks.count': ['count_tasks'],
  'projects.team': ['list_project_team', 'add_project_member', 'remove_project_member'],
  'comments.reactions': ['add_comment_reaction', 'remove_comment_reaction'],
  'attachments.list': ['list_attachments'],
  'attachments.upload': ['upload_attachment'],
  'attachments.delete': ['remove_attachment'],
  'workItems.list': ['list_work'],
  'workItems.create': ['log_work'],
  'workItems.update': ['update_work'],
  'workItems.delete': ['remove_work'],
  'agiles.list': ['list_agiles'],
  'sprints.list': ['list_sprints'],
  'sprints.create': ['create_sprint'],
  'sprints.update': ['update_sprint'],
  'sprints.assign': ['assign_task_to_sprint'],
  'activities.read': ['get_task_history'],
  'queries.saved': ['list_saved_queries', 'run_saved_query'],
}

const unsurfacedCapabilities = (
  providerCapabilities: readonly string[],
  toolKeys: readonly string[],
): readonly string[] => {
  const normalizedToolKeys = new Set(toolKeys.map((toolKey) => lower(toolKey)))
  return providerCapabilities.filter((capability) => {
    const requiredToolKeys = CAPABILITY_TOOL_KEYS[capability]
    if (requiredToolKeys === undefined) {
      return false
    }

    return requiredToolKeys.every((toolKey) => !normalizedToolKeys.has(lower(toolKey)))
  })
}

export const loadCodeindexSummary = (db: Database): CodeindexSummary => {
  const indexedFiles = db
    .query<{ file_path: string }, [string]>('SELECT file_path FROM files WHERE parse_status = ? ORDER BY file_path ASC')
    .all('indexed')
    .map((row) => row.file_path)

  const referenceCountsByFile = Object.fromEntries(
    db
      .query<{ file_path: string; reference_count: number }, []>(
        `SELECT files.file_path AS file_path,
                COUNT(symbol_references.id) AS reference_count
         FROM files
         LEFT JOIN symbol_references ON symbol_references.source_file_id = files.id
         WHERE files.parse_status = 'indexed'
         GROUP BY files.file_path
         ORDER BY files.file_path ASC`,
      )
      .all()
      .map((row) => [row.file_path, row.reference_count] as const),
  )

  return {
    indexedFiles: new Set(indexedFiles),
    referenceCountsByFile,
  }
}

const runtimeEntrypointSignals = (piece: PieceRecord): readonly PieceSignal[] =>
  nonEmptySignal(
    'no-current-runtime-entrypoint',
    isRuntimeBackedPiece(piece) && piece.entrypoints.length === 0 ? [`${piece.name} has no runtime entrypoints.`] : [],
  )

const scriptEntrypointSignals = (piece: PieceRecord): readonly PieceSignal[] =>
  nonEmptySignal(
    'no-current-script-entrypoint',
    isScriptBackedPiece(piece) && piece.relatedScripts.length === 0
      ? [`${piece.name} has no current script entrypoint.`]
      : [],
  )

const testSignals = (piece: PieceRecord): readonly PieceSignal[] =>
  nonEmptySignal('no-tests-found', piece.relatedTests.length === 0 ? [`${piece.name} has no related tests.`] : [])

const docsSignals = (piece: PieceRecord): readonly PieceSignal[] => [
  ...nonEmptySignal(
    'no-current-docs-found',
    piece.relatedDocs.length === 0 ? [`${piece.name} has no current docs.`] : [],
  ),
  ...nonEmptySignal(
    'historical-docs-only',
    onlyHistoricalDocs(piece.relatedDocs) ? [`${piece.name} is only documented in archived or remaining docs.`] : [],
  ),
]

const locationSignals = (piece: PieceRecord): readonly PieceSignal[] => [
  ...nonEmptySignal(
    'script-only-existence',
    onlyPrefixedPaths(piece.primaryPaths, 'scripts/') ? [`${piece.name} only exists under scripts/.`] : [],
  ),
  ...nonEmptySignal(
    'benchmark-only-existence',
    appearsBenchmarkOnly(piece) ? [`${piece.name} appears benchmark-only.`] : [],
  ),
  ...nonEmptySignal('audit-only-existence', appearsAuditOnly(piece) ? [`${piece.name} appears audit-only.`] : []),
]

const wiringSignals = (piece: PieceRecord, referenceCount: number): readonly PieceSignal[] => [
  ...nonEmptySignal(
    'declared-but-not-wired',
    piece.primaryPaths.length > 0 && piece.entrypoints.length === 0 && piece.dependents.length === 0
      ? [`${piece.name} is declared but no activation or dependents were attached.`]
      : [],
  ),
  ...nonEmptySignal(
    'wired-but-lightly-referenced',
    piece.entrypoints.length > 0 && referenceCount <= 1
      ? [`${piece.name} has entrypoints but only ${referenceCount} codeindex references across owned paths.`]
      : [],
  ),
]

const statusSignals = (piece: PieceRecord): readonly PieceSignal[] =>
  nonEmptySignal('status-unclear', piece.status === 'unclear' ? [`${piece.name} is marked unclear.`] : [])

const providerSurfaceSignals = (
  piece: PieceRecord,
  providerCapabilities: readonly string[],
  toolKeys: readonly string[],
): readonly PieceSignal[] => {
  if (piece.type !== 'integration-provider') {
    return []
  }

  return nonEmptySignal(
    'provider-capability-not-surfaced',
    unsurfacedCapabilities(providerCapabilities, toolKeys).map(
      (capability) => `${piece.name} exposes ${capability} without a matching tool family.`,
    ),
  )
}

export const collectPieceSignals = (input: Readonly<CollectSignalsInput>): readonly PieceSignal[] => {
  const referenceCount = totalReferenceCount(input.piece, input.codeindexSummary)

  return uniqueSignals([
    ...runtimeEntrypointSignals(input.piece),
    ...scriptEntrypointSignals(input.piece),
    ...testSignals(input.piece),
    ...docsSignals(input.piece),
    ...locationSignals(input.piece),
    ...wiringSignals(input.piece, referenceCount),
    ...statusSignals(input.piece),
    ...providerSurfaceSignals(input.piece, input.providerCapabilities, input.toolKeys),
  ])
}
