// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { pathToFileURL } from 'node:url'

import { resolveCodeindexModulePaths } from '../codeindex-cli-support.js'

export type RankedSearchResult = Readonly<{
  filePath: string
  startLine: number
  endLine: number
  snippet: string
  symbolKey: string
  qualifiedName: string
}>

export type ImpactResult = Readonly<{
  sourceFilePath: string
  lineNumber: number
  edgeType: string
  sourceQualifiedName: string | null
}>

type CodeindexConfigLoader = (input: { readonly configPath: string; readonly repoRoot: string }) => Promise<{
  readonly dbPath: string
}>

export type CodeindexSearchDeps = Readonly<{
  readonly findSymbolCandidates: (
    db: import('bun:sqlite').Database,
    name: string,
    limit: number,
  ) => RankedSearchResult[]
  readonly findIncomingReferences: (
    db: import('bun:sqlite').Database,
    input: { readonly qualifiedName: string; readonly limit: number },
  ) => ImpactResult[]
}>

type CodeindexDbDeps = Readonly<{
  readonly openDatabase: (dbPath: string) => import('bun:sqlite').Database
}>

type CodeindexConfigModule = Readonly<{
  readonly loadCodeindexConfig: CodeindexConfigLoader
}>

type CodeindexSearchModule = Readonly<{
  readonly findSymbolCandidates: CodeindexSearchDeps['findSymbolCandidates']
  readonly findIncomingReferences: CodeindexSearchDeps['findIncomingReferences']
}>

type CodeindexDbModule = Readonly<{
  readonly openDatabase: CodeindexDbDeps['openDatabase']
}>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && value !== undefined && typeof value === 'object'

const isCodeindexConfigModule = (value: unknown): value is CodeindexConfigModule =>
  isRecord(value) && typeof value['loadCodeindexConfig'] === 'function'

const isCodeindexSearchModule = (value: unknown): value is CodeindexSearchModule =>
  isRecord(value) &&
  typeof value['findSymbolCandidates'] === 'function' &&
  typeof value['findIncomingReferences'] === 'function'

const isCodeindexDbModule = (value: unknown): value is CodeindexDbModule =>
  isRecord(value) && typeof value['openDatabase'] === 'function'

export type LoadedCodeindexDeps = Readonly<{
  readonly loadCodeindexConfig: CodeindexConfigLoader
  readonly search: CodeindexSearchDeps
  readonly db: CodeindexDbDeps
}>

export const loadCodeindexDeps = async (repoRoot: string): Promise<LoadedCodeindexDeps> => {
  const modulePaths = resolveCodeindexModulePaths({ repoRoot })
  const [configModule, searchModule, dbModule]: [unknown, unknown, unknown] = await Promise.all([
    import(pathToFileURL(modulePaths.configModulePath).href).then((module): unknown => module),
    import(pathToFileURL(modulePaths.searchModulePath).href).then((module): unknown => module),
    import(pathToFileURL(modulePaths.storageDbModulePath).href).then((module): unknown => module),
  ])

  if (!isCodeindexConfigModule(configModule)) {
    throw new TypeError(`Invalid codeindex config module: ${modulePaths.configModulePath}`)
  }
  if (!isCodeindexSearchModule(searchModule)) {
    throw new TypeError(`Invalid codeindex search module: ${modulePaths.searchModulePath}`)
  }
  if (!isCodeindexDbModule(dbModule)) {
    throw new TypeError(`Invalid codeindex db module: ${modulePaths.storageDbModulePath}`)
  }

  return {
    loadCodeindexConfig: configModule.loadCodeindexConfig,
    search: {
      findSymbolCandidates: searchModule.findSymbolCandidates,
      findIncomingReferences: searchModule.findIncomingReferences,
    },
    db: {
      openDatabase: dbModule.openDatabase,
    },
  }
}
