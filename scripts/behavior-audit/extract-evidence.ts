// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

import type { CodeindexSearchDeps, RankedSearchResult, ImpactResult } from './extract-evidence-loader.js'
import { loadCodeindexDeps } from './extract-evidence-loader.js'
import type { EvidenceRef, CodeindexProvenance, CodeindexQueryProvenance } from './extract-trust-types.js'
import type { TestCase } from './test-parser.js'

export interface EvidenceBundle {
  readonly behaviorEvidence: readonly EvidenceRef[]
  readonly contextEvidence: readonly EvidenceRef[]
  readonly keywordEvidence: readonly EvidenceRef[]
  readonly evidenceFilesRead: readonly string[]
  readonly dependencyPaths: readonly string[]
  readonly codeindex: CodeindexProvenance
}

export interface CollectEvidenceInput {
  readonly testCase: TestCase
  readonly testFilePath: string
  readonly manifestDependencyPaths: readonly string[]
}

function extractImportedNames(source: string): readonly string[] {
  const pattern = /import\s*\{([^}]+)\}\s*from/gu
  const names: string[] = []
  let match: RegExpExecArray | null = null
  while ((match = pattern.exec(source)) !== null) {
    const raw = match[1]!
    const parsed = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && s !== 'type')
      .map((s) => s.replace(/^type\s+/u, ''))
      .filter((s) => s.length > 0)
    names.push(...parsed)
  }
  return names
}

const toCodeindexSymbolRef = (result: Readonly<RankedSearchResult>): EvidenceRef => ({
  kind: 'codeindex-symbol',
  filePath: result.filePath,
  startLine: result.startLine,
  endLine: result.endLine,
  snippet: result.snippet,
  supports: 'context',
  symbolKey: result.symbolKey,
  qualifiedName: result.qualifiedName,
})

const toCodeindexReferenceRef = (impact: Readonly<ImpactResult>): EvidenceRef => ({
  kind: 'codeindex-reference',
  filePath: impact.sourceFilePath,
  startLine: impact.lineNumber,
  endLine: impact.lineNumber,
  snippet: `${impact.edgeType}: ${impact.sourceQualifiedName ?? 'unknown'}`,
  supports: 'context',
  qualifiedName: impact.sourceQualifiedName ?? undefined,
})

const toTestSourceRef = (testCase: Readonly<TestCase>, testFilePath: string): EvidenceRef => ({
  kind: 'test-source',
  filePath: testFilePath,
  startLine: testCase.startLine,
  endLine: testCase.endLine,
  snippet: testCase.source,
  supports: 'behavior',
})

const toManifestDependencyRef = (depPath: string): EvidenceRef => ({
  kind: 'manifest-dependency',
  filePath: depPath,
  startLine: 0,
  endLine: 0,
  snippet: '',
  supports: 'context',
})

const checkIndexFreshness = (db: import('bun:sqlite').Database): CodeindexProvenance['indexStatus'] => {
  const row = db.query<{ count: number }, []>('SELECT COUNT(*) AS count FROM symbols').get()
  if (row === null || row.count === 0) return 'missing'

  const recentRow = db
    .query<{ has_recent: number }, [number]>('SELECT EXISTS(SELECT 1 FROM files WHERE indexed_at > ?) AS has_recent')
    .get(Date.now() - 7 * 24 * 60 * 60 * 1000)

  return recentRow !== null && recentRow.has_recent > 0 ? 'fresh' : 'stale'
}

interface CodeindexEvidence {
  readonly symbolRefs: readonly EvidenceRef[]
  readonly referenceRefs: readonly EvidenceRef[]
  readonly additionalFiles: readonly string[]
  readonly queries: readonly CodeindexQueryProvenance[]
  readonly indexStatus: CodeindexProvenance['indexStatus']
}

const collectCodeindexEvidence = (
  db: import('bun:sqlite').Database,
  testSource: string,
  findSymbolCandidates: CodeindexSearchDeps['findSymbolCandidates'],
  findIncomingReferences: CodeindexSearchDeps['findIncomingReferences'],
): CodeindexEvidence => {
  const indexStatus = checkIndexFreshness(db)
  const importedNames = extractImportedNames(testSource)
  const queries: CodeindexQueryProvenance[] = []
  const additionalFiles: string[] = []
  const symbolRefs: EvidenceRef[] = []
  const referenceRefs: EvidenceRef[] = []

  const allSymbols: RankedSearchResult[] = []
  for (const name of importedNames) {
    const results = findSymbolCandidates(db, name, 5)
    queries.push({ tool: 'code_symbol', query: name, resultCount: results.length })
    allSymbols.push(...results)
  }

  for (const symbol of allSymbols) {
    symbolRefs.push(toCodeindexSymbolRef(symbol))
    additionalFiles.push(symbol.filePath)
  }

  const topSymbols = allSymbols.slice(0, 5)
  for (const symbol of topSymbols) {
    const impacts = findIncomingReferences(db, {
      qualifiedName: symbol.qualifiedName,
      limit: 20,
    })
    queries.push({ tool: 'code_impact', query: symbol.qualifiedName, resultCount: impacts.length })
    for (const impact of impacts) {
      referenceRefs.push(toCodeindexReferenceRef(impact))
      additionalFiles.push(impact.sourceFilePath)
    }
  }

  return { symbolRefs, referenceRefs, additionalFiles, queries, indexStatus }
}

async function loadCodeindexEvidenceBundle(input: {
  readonly testCase: TestCase
  readonly manifestDependencyPaths: readonly string[]
  readonly evidenceFilesRead: string[]
}): Promise<{ readonly ciEvidence: CodeindexEvidence; readonly repoRoot: string }> {
  const repoRoot = path.resolve(import.meta.dir, '../..')
  const codeindex = await loadCodeindexDeps(repoRoot)
  const config = await codeindex.loadCodeindexConfig({
    configPath: path.join(repoRoot, '.codeindex.json'),
    repoRoot,
  })
  const db = codeindex.db.openDatabase(config.dbPath)
  try {
    const ciEvidence = collectCodeindexEvidence(
      db,
      input.testCase.source,
      codeindex.search.findSymbolCandidates,
      codeindex.search.findIncomingReferences,
    )
    const uniqueNewFiles = ciEvidence.additionalFiles.filter((f) => !input.evidenceFilesRead.includes(f))
    input.evidenceFilesRead.push(...uniqueNewFiles)
    return { ciEvidence, repoRoot }
  } finally {
    db.close()
  }
}

export const collectEvidence = async (input: Readonly<CollectEvidenceInput>): Promise<EvidenceBundle> => {
  const behaviorEvidence: EvidenceRef[] = [toTestSourceRef(input.testCase, input.testFilePath)]
  const manifestRefs = input.manifestDependencyPaths.map(toManifestDependencyRef)
  const evidenceFilesRead: string[] = [input.testFilePath, ...input.manifestDependencyPaths]

  try {
    const { ciEvidence } = await loadCodeindexEvidenceBundle({
      testCase: input.testCase,
      manifestDependencyPaths: input.manifestDependencyPaths,
      evidenceFilesRead,
    })

    return {
      behaviorEvidence,
      contextEvidence: [...manifestRefs, ...ciEvidence.symbolRefs, ...ciEvidence.referenceRefs],
      keywordEvidence: [],
      evidenceFilesRead,
      dependencyPaths: input.manifestDependencyPaths,
      codeindex: {
        enabled: true,
        mode: 'direct',
        indexStatus: ciEvidence.indexStatus,
        queries: ciEvidence.queries,
      },
    }
  } catch {
    return {
      behaviorEvidence,
      contextEvidence: manifestRefs,
      keywordEvidence: [],
      evidenceFilesRead,
      dependencyPaths: input.manifestDependencyPaths,
      codeindex: { enabled: false, mode: 'unavailable', indexStatus: 'unknown', queries: [] },
    }
  }
}
