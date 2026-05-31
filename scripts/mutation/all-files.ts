// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import fs from 'node:fs'
import path from 'node:path'

import { Glob } from 'bun'

import type { StrykerConfig } from './config-builder.js'
import { pairedRun, resolvePairedRunExitCode } from './paired-run.js'
import type { PairedRunInput, PairedRunResult } from './paired-run.js'

export interface AllFilesDeps {
  readonly readBaseConfig: (projectRoot: string) => StrykerConfig
  readonly listProjectFiles: (projectRoot: string, baseConfig: StrykerConfig) => readonly string[]
  readonly runPaired: (input: PairedRunInput) => Promise<PairedRunResult>
  readonly log: (message: string) => void
}

export interface SelectAllMutationTargetsInput {
  readonly baseConfig: StrykerConfig
  readonly projectFiles: readonly string[]
}

export interface AllFilesRunInput {
  readonly projectRoot: string
  readonly reportDir: string
  readonly verbose: boolean | undefined
  readonly deps: AllFilesDeps | undefined
}

export type AllFilesCliArgs =
  | { readonly kind: 'ok'; readonly threshold: number; readonly verbose: boolean }
  | { readonly kind: 'usageError'; readonly reason: string }

type BunLike = {
  readonly argv: readonly string[]
  readonly main: string
}

const DEFAULT_REPORT_DIR = 'reports/paired'
const THRESHOLD_DECIMAL_PATTERN = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u
const THRESHOLD_RANGE_ERROR = 'threshold must be a decimal number between 0 and 1'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const isStrykerConfig = (value: unknown): value is StrykerConfig => isRecord(value)

const hasGlobSyntax = (pattern: string): boolean => /[*?[\]{}()]/u.test(pattern)

const getMutatePatterns = (baseConfig: StrykerConfig): readonly string[] => {
  if (!Array.isArray(baseConfig.mutate) || !baseConfig.mutate.every((pattern) => typeof pattern === 'string')) {
    throw new Error('stryker config must define mutate as a string array')
  }
  return baseConfig.mutate
}

const normalizePath = (filePath: string): string => filePath.replaceAll('\\', '/')

const matchesPattern = (pattern: string, filePath: string): boolean => new Glob(pattern).match(filePath)

const scanPattern = (projectRoot: string, pattern: string): readonly string[] => {
  if (!hasGlobSyntax(pattern)) {
    const absolutePath = path.join(projectRoot, pattern)
    return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile() ? [pattern] : []
  }
  return [...new Glob(pattern).scanSync({ cwd: projectRoot, onlyFiles: true })].map((filePath) =>
    normalizePath(filePath),
  )
}

const listConfiguredProjectFiles = (projectRoot: string, baseConfig: StrykerConfig): readonly string[] => {
  const includePatterns = getMutatePatterns(baseConfig).filter((pattern) => !pattern.startsWith('!'))
  return includePatterns.flatMap((pattern) => scanPattern(projectRoot, pattern))
}

const defaultDeps: AllFilesDeps = {
  readBaseConfig: (projectRoot) => {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(projectRoot, 'stryker.config.json'), 'utf8'))
    if (!isStrykerConfig(parsed)) {
      throw new Error('stryker.config.json must contain a JSON object')
    }
    return parsed
  },
  listProjectFiles: listConfiguredProjectFiles,
  runPaired: pairedRun,
  log: (message) => {
    console.log(message)
  },
}

const resolveDeps = (deps: AllFilesDeps | undefined): AllFilesDeps => {
  if (deps === undefined) return defaultDeps
  return deps
}

export const selectAllMutationTargets = (input: SelectAllMutationTargetsInput): string[] => {
  const mutatePatterns = getMutatePatterns(input.baseConfig)
  const includePatterns = mutatePatterns.filter((pattern) => !pattern.startsWith('!'))
  const excludePatterns = mutatePatterns.filter((pattern) => pattern.startsWith('!')).map((pattern) => pattern.slice(1))

  return input.projectFiles
    .map(normalizePath)
    .filter((filePath) => includePatterns.some((pattern) => matchesPattern(pattern, filePath)))
    .filter((filePath) => !excludePatterns.some((pattern) => matchesPattern(pattern, filePath)))
    .filter((filePath, index, files) => files.indexOf(filePath) === index)
    .toSorted()
}

export const allFilesRun = (input: AllFilesRunInput): Promise<PairedRunResult> => {
  const deps = resolveDeps(input.deps)
  const baseConfig = deps.readBaseConfig(input.projectRoot)
  const projectFiles = deps.listProjectFiles(input.projectRoot, baseConfig)
  const sourceFiles = selectAllMutationTargets({ baseConfig, projectFiles })
  deps.log(`Full paired mutation targets: ${sourceFiles.length}`)
  return deps.runPaired({
    projectRoot: input.projectRoot,
    reportDir: input.reportDir,
    sourceFiles,
    verbose: input.verbose === true,
    deps: undefined,
  })
}

export const parseAllFilesCliArgs = (argv: readonly string[]): AllFilesCliArgs => {
  const unknownArg = argv.find((arg) => arg.startsWith('-') && !arg.startsWith('--threshold=') && arg !== '--verbose')
  if (unknownArg !== undefined) return { kind: 'usageError', reason: `unknown argument ${unknownArg}` }

  const positionalArg = argv.find((arg) => !arg.startsWith('--threshold=') && arg !== '--verbose')
  if (positionalArg !== undefined)
    return { kind: 'usageError', reason: `unexpected positional argument ${positionalArg}` }

  const thresholdArgs = argv.filter((arg) => arg.startsWith('--threshold='))
  if (thresholdArgs.length > 1) return { kind: 'usageError', reason: 'threshold must be provided at most once' }

  const thresholdArg = thresholdArgs[0]
  const thresholdText = thresholdArg === undefined ? undefined : thresholdArg.slice('--threshold='.length)
  if (thresholdText === '') return { kind: 'usageError', reason: 'threshold must be a finite number' }
  if (thresholdText !== undefined && !THRESHOLD_DECIMAL_PATTERN.test(thresholdText)) {
    return { kind: 'usageError', reason: THRESHOLD_RANGE_ERROR }
  }
  const threshold = thresholdText === undefined ? 0 : Number(thresholdText)
  if (!Number.isFinite(threshold)) return { kind: 'usageError', reason: 'threshold must be a finite number' }

  return { kind: 'ok', threshold, verbose: argv.includes('--verbose') }
}

const main = async (bun: BunLike): Promise<number> => {
  const parsed = parseAllFilesCliArgs(bun.argv.slice(2))
  if (parsed.kind === 'usageError') {
    console.error(parsed.reason)
    console.error('Usage: bun scripts/mutation/all-files.ts [--threshold=N] [--verbose]')
    return 2
  }

  const projectRoot = process.cwd()
  const result = await allFilesRun({
    projectRoot,
    reportDir: path.join(projectRoot, DEFAULT_REPORT_DIR),
    verbose: parsed.verbose,
    deps: undefined,
  })

  if (resolvePairedRunExitCode(result.merged, parsed.threshold) === 1) {
    console.error(`Mutation score ${result.merged.score} is below threshold ${parsed.threshold}`)
    return 1
  }
  return 0
}

const maybeBun = (globalThis as typeof globalThis & { readonly Bun: BunLike | undefined }).Bun
if (maybeBun !== undefined && import.meta.path === maybeBun.main) {
  process.exit(await main(maybeBun))
}
