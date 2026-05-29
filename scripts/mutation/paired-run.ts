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
  readonly deps?: PairedRunDeps
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

const isStrykerReport = (value: unknown): value is StrykerReport =>
  isRecord(value) && (value['files'] === undefined || isRecord(value['files']))

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

const safeFileStem = (srcFile: string): string => srcFile.replace(/[^a-zA-Z0-9._-]+/gu, '__')

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

export const pairedRun = (input: PairedRunInput): Promise<PairedRunResult> => {
  const deps = input.deps ?? defaultDeps
  const sourceFiles = input.sourceFiles.map((filePath) => toProjectRelativePath(filePath, input.projectRoot))
  const base = deps.readBaseConfig(input.projectRoot)
  const overrides = deps.loadOverrides(input.projectRoot)
  fs.mkdirSync(input.reportDir, { recursive: true })

  const results = sourceFiles.map((srcFile) => runOneFile(srcFile, input, deps, base, overrides))
  const completed = results.filter((result): result is CompletedFileRun => !isSkippedFile(result))
  const perFile = completed.map(({ report: _report, ...result }) => result)
  const skipped = results.filter(isSkippedFile)
  const merged = mergeReports(completed.map((result) => result.report))

  deps.log(
    `Paired mutation summary: files=${perFile.length} skipped=${skipped.length} killed=${merged.killed} survived=${merged.survived} pending=${merged.pending} score=${merged.score}`,
  )
  return Promise.resolve({ merged, perFile, skipped })
}

const parseCliArgs = (
  argv: readonly string[],
): { readonly sourceFiles: readonly string[]; readonly threshold: number } => {
  const thresholdArg = argv.find((arg) => arg.startsWith('--threshold='))
  return {
    sourceFiles: argv.filter((arg) => !arg.startsWith('--threshold=')),
    threshold: thresholdArg === undefined ? 0 : Number(thresholdArg.slice('--threshold='.length)),
  }
}

const main = async (bun: BunLike): Promise<number> => {
  const { sourceFiles, threshold } = parseCliArgs(bun.argv.slice(2))
  if (sourceFiles.length === 0) {
    console.error('Usage: bun scripts/mutation/paired-run.ts <src...> [--threshold=N]')
    return 2
  }

  const projectRoot = process.cwd()
  const result = await pairedRun({
    projectRoot,
    reportDir: path.join(projectRoot, DEFAULT_REPORT_DIR),
    sourceFiles,
  })

  if (result.merged.scored > 0 && result.merged.score < threshold) {
    console.error(`Mutation score ${result.merged.score} is below threshold ${threshold}`)
    return 1
  }
  return 0
}

const maybeBun = (globalThis as typeof globalThis & { readonly Bun?: BunLike }).Bun
if (maybeBun !== undefined && import.meta.path === maybeBun.main) {
  process.exit(await main(maybeBun))
}
