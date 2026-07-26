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
import { readJsonRecord, readStrykerReport } from './json-readers.js'
import { parsePairedRunCliArgs, resolvePairedRunCliUsageExitCode, resolvePairedRunExitCode } from './paired-run-cli.js'
import { appendProcessFailure } from './process-error.js'
import { mergeReports } from './score-merger.js'
import type { MergedScore, StrykerReport } from './score-merger.js'
import { runStrykerWithCapturedFailure } from './stryker-run.js'
import { loadOverrides as loadOverridesFile, resolveTestFiles } from './test-overrides.js'
import type { OverridesMap } from './test-overrides.js'

export { parsePairedRunCliArgs, resolvePairedRunCliUsageExitCode, resolvePairedRunExitCode } from './paired-run-cli.js'
export type { PairedRunCliArgs } from './paired-run-cli.js'

export interface PairedRunDeps {
  readonly readBaseConfig: (projectRoot: string) => StrykerConfig
  readonly resolveCompanion: (srcFile: string, projectRoot: string) => string | null
  readonly loadOverrides: (projectRoot: string) => OverridesMap
  readonly runStryker: (configPath: string, projectRoot: string, options: PairedRunStrykerOptions) => void
  readonly readReport: (reportPath: string) => StrykerReport
  readonly log: (message: string) => void
}

export interface PairedRunInput {
  readonly projectRoot: string
  readonly reportDir: string
  readonly sourceFiles: readonly string[]
  readonly verbose: boolean | undefined
  readonly deps: PairedRunDeps | undefined
}

export interface PairedRunStrykerOptions {
  readonly verbose: boolean
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

export interface ErroredFile {
  readonly sourceFile: string
  readonly error: string
}

export interface PairedRunResult {
  readonly merged: MergedScore
  readonly perFile: readonly PairedRunFileResult[]
  readonly skipped: readonly SkippedFile[]
  readonly errored: readonly ErroredFile[]
}

type CompletedFileRun = PairedRunFileResult & { readonly report: StrykerReport }

type BunLike = {
  readonly argv: readonly string[]
  readonly main: string
}

const DEFAULT_REPORT_DIR = 'reports/paired'
const STRYKER_TIMEOUT_MS = 30 * 60 * 1000

const defaultDeps: PairedRunDeps = {
  readBaseConfig: (projectRoot) => {
    const configPath = path.join(projectRoot, 'stryker.config.json')
    return readJsonRecord(configPath)
  },
  resolveCompanion: (srcFile, projectRoot) => findTestFile(path.join(projectRoot, srcFile), projectRoot),
  loadOverrides: (projectRoot) => loadOverridesFile(path.join(projectRoot, 'scripts/mutation/overrides.json')),
  runStryker: (configPath, projectRoot, options) => {
    execFileSync(path.join(projectRoot, 'node_modules/.bin/stryker'), ['run', configPath], {
      cwd: projectRoot,
      stdio: options.verbose ? 'inherit' : 'pipe',
      timeout: STRYKER_TIMEOUT_MS,
      maxBuffer: 20 * 1024 * 1024,
    })
  },
  readReport: readStrykerReport,
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
  verbose: boolean,
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
  fs.rmSync(reportPath, { force: true })
  const strykerRun = runStrykerWithCapturedFailure(deps, configPath, input.projectRoot, verbose)
  if (!fs.existsSync(reportPath)) {
    const message = `missing Stryker JSON report for ${srcFile}: ${reportPath}`
    throw new Error(
      strykerRun.kind === 'ok'
        ? message
        : appendProcessFailure(message, 'Stryker failed before writing the report', strykerRun.error),
    )
  }
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

const formatFileSummary = (result: PairedRunFileResult): string =>
  `${result.sourceFile}: killed=${result.merged.killed} survived=${result.merged.survived} noCoverage=${result.merged.noCoverage} pending=${result.merged.pending} score=${result.merged.score}`

const resolveDeps = (deps: PairedRunDeps | undefined): PairedRunDeps => {
  if (deps === undefined) return defaultDeps
  return deps
}

export const pairedRun = (input: PairedRunInput): Promise<PairedRunResult> => {
  const deps = resolveDeps(input.deps)
  const verbose = input.verbose === true
  const sourceFiles = input.sourceFiles.map((filePath) => toProjectRelativePath(filePath, input.projectRoot))
  const base = deps.readBaseConfig(input.projectRoot)
  const overrides = deps.loadOverrides(input.projectRoot)
  fs.mkdirSync(input.reportDir, { recursive: true })

  const completed: CompletedFileRun[] = []
  const skipped: SkippedFile[] = []
  const errored: ErroredFile[] = []

  sourceFiles.forEach((srcFile, index) => {
    deps.log(`Running paired mutation ${index + 1}/${sourceFiles.length}: ${srcFile}`)
    try {
      const result = runOneFile(srcFile, input, deps, base, overrides, verbose)
      if (isSkippedFile(result)) skipped.push(result)
      else {
        deps.log(formatFileSummary(result))
        completed.push(result)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      deps.log(`${srcFile}: ERROR ${message}`)
      errored.push({ sourceFile: srcFile, error: message })
    }
  })
  const perFile = completed.map(({ report: _report, ...result }) => result)
  const merged = mergeReports(completed.map((result) => result.report))

  deps.log(
    `Paired mutation summary: files=${perFile.length} skipped=${skipped.length} errored=${errored.length} killed=${merged.killed} survived=${merged.survived} pending=${merged.pending} score=${merged.score}`,
  )
  return Promise.resolve({ merged, perFile, skipped, errored })
}

const main = async (bun: BunLike): Promise<number> => {
  const parsed = parsePairedRunCliArgs(bun.argv.slice(2))
  const usageExitCode = resolvePairedRunCliUsageExitCode(parsed)
  if (parsed.kind === 'usageError') {
    console.error(parsed.reason)
    if (usageExitCode === null) return 2
    return usageExitCode
  }
  const { sourceFiles, threshold, verbose } = parsed
  if (usageExitCode !== null) {
    console.error('Usage: bun scripts/mutation/paired-run.ts <src...> [--threshold=N] [--verbose]')
    return usageExitCode
  }

  const projectRoot = process.cwd()
  const result = await pairedRun({
    projectRoot,
    reportDir: path.join(projectRoot, DEFAULT_REPORT_DIR),
    sourceFiles,
    verbose,
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
