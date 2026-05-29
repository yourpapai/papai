// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { findTestFile } from '../../.hooks/tdd/test-resolver.mjs'
import { buildPairedConfig } from './config-builder.js'
import type { StrykerConfig } from './config-builder.js'
import { mergeReports } from './score-merger.js'
import type { MergedScore, StrykerReport } from './score-merger.js'
import { loadOverrides as loadOverridesFile, resolveTestFiles } from './test-overrides.js'
import type { OverridesMap } from './test-overrides.js'

export interface PairedRunDeps {
  readonly readBaseConfig: (projectRoot: string) => StrykerConfig
  readonly resolveCompanion: (srcFile: string, projectRoot: string) => string | null
  readonly loadOverrides: (projectRoot: string) => OverridesMap
  readonly runStryker: (configPath: string, projectRoot: string) => void
  readonly readReport: (reportPath: string) => StrykerReport
  readonly log: (message: string) => void
}

export interface PairedRunInput {
  readonly projectRoot: string
  readonly reportDir: string
  readonly sourceFiles: readonly string[]
  readonly deps: PairedRunDeps | undefined
}

export interface SkippedFile {
  readonly sourceFile: string
  readonly reason: string
}

export interface PairedRunFileResult {
  readonly sourceFile: string
  readonly testFiles: readonly string[]
  readonly configPath: string
  readonly reportPath: string
  readonly merged: MergedScore
}

export interface PairedRunResult {
  readonly merged: MergedScore
  readonly perFile: readonly PairedRunFileResult[]
  readonly skipped: readonly SkippedFile[]
}

export type PairedRunCliArgs =
  | { readonly kind: 'ok'; readonly sourceFiles: readonly string[]; readonly threshold: number }
  | { readonly kind: 'usageError'; readonly reason: string }

type CompletedFileRun = PairedRunFileResult & { readonly report: StrykerReport }

type BunLike = {
  readonly argv: readonly string[]
  readonly main: string
}

const DEFAULT_REPORT_DIR = 'reports/paired'
const STRYKER_TIMEOUT_MS = 30 * 60 * 1000

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const readJsonRecord = (filePath: string): Record<string, unknown> => {
  const parsed: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error(`${filePath} must contain a JSON object`)
  }
  return parsed
}

const isStrykerReport = (value: unknown): value is StrykerReport => {
  if (!isRecord(value)) return false
  const files = value['files']
  if (files === undefined) return true
  return isRecord(files)
}

const defaultDeps: PairedRunDeps = {
  readBaseConfig: (projectRoot) => {
    const configPath = path.join(projectRoot, 'stryker.config.json')
    return readJsonRecord(configPath)
  },
  resolveCompanion: (srcFile, projectRoot) => findTestFile(path.join(projectRoot, srcFile), projectRoot),
  loadOverrides: (projectRoot) => loadOverridesFile(path.join(projectRoot, 'scripts/mutation/overrides.json')),
  runStryker: (configPath, projectRoot) => {
    execFileSync(path.join(projectRoot, 'node_modules/.bin/stryker'), ['run', configPath], {
      cwd: projectRoot,
      stdio: 'inherit',
      timeout: STRYKER_TIMEOUT_MS,
    })
  },
  readReport: (reportPath) => {
    const parsed: unknown = JSON.parse(fs.readFileSync(reportPath, 'utf8'))
    if (!isStrykerReport(parsed)) {
      throw new Error(`${reportPath} must contain a Stryker JSON report object`)
    }
    return parsed
  },
  log: (message) => {
    console.log(message)
  },
}

const toProjectRelativePath = (filePath: string, projectRoot: string): string =>
  path.isAbsolute(filePath) ? path.relative(projectRoot, filePath) : filePath

const toAbsolutePath = (filePath: string, projectRoot: string): string =>
  path.isAbsolute(filePath) ? filePath : path.join(projectRoot, filePath)

const safeFileStem = (srcFile: string): string => srcFile.replaceAll(/[^a-zA-Z0-9._-]+/gu, '__')

const writePairedConfig = (input: {
  readonly base: StrykerConfig
  readonly reportDir: string
  readonly srcFile: string
  readonly testFiles: readonly string[]
}): { readonly configPath: string; readonly reportPath: string } => {
  const stem = safeFileStem(input.srcFile)
  const configPath = path.join(input.reportDir, `${stem}.stryker.config.json`)
  const reportPath = path.join(input.reportDir, `${stem}.stryker-report.json`)
  const config = buildPairedConfig({
    base: input.base,
    srcFile: input.srcFile,
    testFiles: [...input.testFiles],
    reportPath,
  })
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`)
  return { configPath, reportPath }
}

const companionResolverFor =
  (deps: PairedRunDeps) =>
  (implAbsPath: string, projectRoot: string): string | null => {
    const srcFile = path.relative(projectRoot, implAbsPath)
    const companion = deps.resolveCompanion(srcFile, projectRoot)
    return companion === null ? null : toAbsolutePath(companion, projectRoot)
  }

const runOneFile = (
  srcFile: string,
  input: PairedRunInput,
  deps: PairedRunDeps,
  base: StrykerConfig,
  overrides: OverridesMap,
): CompletedFileRun | SkippedFile => {
  const resolved = resolveTestFiles({
    srcFile,
    projectRoot: input.projectRoot,
    overrides,
    findTestFile: companionResolverFor(deps),
  })
  if (resolved.kind === 'skip') return { sourceFile: srcFile, reason: resolved.reason }

  const { configPath, reportPath } = writePairedConfig({
    base,
    reportDir: input.reportDir,
    srcFile,
    testFiles: resolved.testFiles,
  })
  deps.runStryker(configPath, input.projectRoot)
  const report = deps.readReport(reportPath)
  return {
    sourceFile: srcFile,
    testFiles: resolved.testFiles,
    configPath,
    reportPath,
    report,
    merged: mergeReports([report]),
  }
}

const isSkippedFile = (result: CompletedFileRun | SkippedFile): result is SkippedFile => !('reportPath' in result)

const resolveDeps = (deps: PairedRunDeps | undefined): PairedRunDeps => {
  if (deps === undefined) return defaultDeps
  return deps
}

export const pairedRun = (input: PairedRunInput): Promise<PairedRunResult> => {
  const deps = resolveDeps(input.deps)
  const sourceFiles = input.sourceFiles.map((filePath) => toProjectRelativePath(filePath, input.projectRoot))
  const base = deps.readBaseConfig(input.projectRoot)
  const overrides = deps.loadOverrides(input.projectRoot)
  fs.mkdirSync(input.reportDir, { recursive: true })

  const results = sourceFiles.map((srcFile) => runOneFile(srcFile, input, deps, base, overrides))
  const completed = results.filter((result): result is CompletedFileRun => !isSkippedFile(result))
  const perFile = completed.map(({ report: _report, ...result }) => result)
  const skipped = results.filter((result) => isSkippedFile(result))
  const merged = mergeReports(completed.map((result) => result.report))

  deps.log(
    `Paired mutation summary: files=${perFile.length} skipped=${skipped.length} killed=${merged.killed} survived=${merged.survived} pending=${merged.pending} score=${merged.score}`,
  )
  return Promise.resolve({ merged, perFile, skipped })
}

export const parsePairedRunCliArgs = (argv: readonly string[]): PairedRunCliArgs => {
  const thresholdArgs = argv.filter((arg) => arg.startsWith('--threshold='))
  if (thresholdArgs.length > 1) {
    return { kind: 'usageError', reason: 'threshold must be provided at most once' }
  }
  const thresholdArg = thresholdArgs[0]
  const thresholdText = thresholdArg === undefined ? undefined : thresholdArg.slice('--threshold='.length)
  const threshold = thresholdText === undefined ? 0 : Number(thresholdText)
  if (thresholdText === '') {
    return { kind: 'usageError', reason: 'threshold must be a finite number' }
  }
  if (!Number.isFinite(threshold)) {
    return { kind: 'usageError', reason: 'threshold must be a finite number' }
  }
  return {
    kind: 'ok',
    sourceFiles: argv.filter((arg) => !arg.startsWith('--threshold=')),
    threshold,
  }
}

export const resolvePairedRunCliUsageExitCode = (parsed: PairedRunCliArgs): number | null =>
  parsed.kind === 'usageError' || parsed.sourceFiles.length === 0 ? 2 : null

export const resolvePairedRunExitCode = (merged: MergedScore, threshold: number): number =>
  merged.score < threshold ? 1 : 0

const main = async (bun: BunLike): Promise<number> => {
  const parsed = parsePairedRunCliArgs(bun.argv.slice(2))
  const usageExitCode = resolvePairedRunCliUsageExitCode(parsed)
  if (parsed.kind === 'usageError') {
    console.error(parsed.reason)
    if (usageExitCode === null) return 2
    return usageExitCode
  }
  const { sourceFiles, threshold } = parsed
  if (usageExitCode !== null) {
    console.error('Usage: bun scripts/mutation/paired-run.ts <src...> [--threshold=N]')
    return usageExitCode
  }

  const projectRoot = process.cwd()
  const result = await pairedRun({
    projectRoot,
    reportDir: path.join(projectRoot, DEFAULT_REPORT_DIR),
    sourceFiles,
    deps: undefined,
  })

  if (resolvePairedRunExitCode(result.merged, threshold) === 1) {
    console.error(`Mutation score ${result.merged.score} is below threshold ${threshold}`)
    return 1
  }
  return 0
}

const maybeBun = (globalThis as typeof globalThis & { readonly Bun: BunLike | undefined }).Bun
if (maybeBun !== undefined && import.meta.path === maybeBun.main) {
  process.exit(await main(maybeBun))
}
