// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { isGateableImplFile } from '../../.hooks/tdd/test-resolver.mjs'
import { buildBaselineFromPerFile, loadBaseline, resolveRatchet, seedMerge, writeBaseline } from './baseline.js'
import type { BaselineMap, PerFileScore } from './baseline.js'
import { pairedRun, resolvePairedRunExitCode } from './paired-run.js'
import type { PairedRunInput, PairedRunResult } from './paired-run.js'
import { SCORES_FILE, writeScoresFile } from './seed-from.js'

export interface ChangedFilesDeps {
  readonly runGit: (args: readonly string[]) => string
  readonly isGateableImpl: (relPath: string, projectRoot: string) => boolean
}

export interface SelectInput {
  readonly baseRef: string
  readonly projectRoot: string
  readonly deps: ChangedFilesDeps | undefined
}

type ChangedFilesCliArgs =
  | {
      readonly kind: 'ok'
      readonly baseRef: string
      readonly threshold: number
      readonly noRatchet: boolean
      readonly verbose: boolean
      readonly updateBaseline: boolean
    }
  | { readonly kind: 'usageError'; readonly reason: string }

export interface ChangedFilesRunDeps {
  readonly selectTargets: (baseRef: string, projectRoot: string) => readonly string[]
  readonly runPaired: (input: PairedRunInput) => Promise<PairedRunResult>
  readonly log: (message: string) => void
}

export interface ChangedFilesRunInput {
  readonly projectRoot: string
  readonly reportDir: string
  readonly baseRef: string
  readonly baseline: BaselineMap
  readonly verbose: boolean | undefined
  readonly deps: ChangedFilesRunDeps | undefined
}

type BunLike = {
  readonly argv: readonly string[]
  readonly main: string
}

const DEFAULT_BASE_REF = 'origin/master'
const DEFAULT_REPORT_DIR = 'reports/paired'
const BASELINE_FILE = 'scripts/mutation/baseline.json'
const THRESHOLD_DECIMAL_PATTERN = /^(0(?:\.\d+)?|1(?:\.0+)?)$/u
const THRESHOLD_RANGE_ERROR = 'threshold must be a decimal number between 0 and 1'

const defaultDeps: ChangedFilesDeps = {
  runGit: (args) =>
    execFileSync('git', [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  isGateableImpl: isGateableImplFile,
}

const defaultRunDeps: ChangedFilesRunDeps = {
  selectTargets: (baseRef, projectRoot) => selectChangedMutationTargets({ baseRef, projectRoot, deps: undefined }),
  runPaired: pairedRun,
  log: (message) => {
    console.log(message)
  },
}

const resolveDeps = (deps: ChangedFilesDeps | undefined): ChangedFilesDeps => {
  if (deps === undefined) return defaultDeps
  return deps
}

export const selectChangedMutationTargets = (input: SelectInput): string[] => {
  const deps = resolveDeps(input.deps)
  const output = deps.runGit(['diff', '--name-only', '--diff-filter=ACMRT', `${input.baseRef}...HEAD`])
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((relPath) => deps.isGateableImpl(relPath, input.projectRoot))
    .filter((relPath, index, paths) => paths.indexOf(relPath) === index)
    .toSorted()
}

const parseThreshold = (text: string | undefined): ChangedFilesCliArgs | number => {
  if (text === undefined) return 0
  if (text === '') return { kind: 'usageError', reason: 'threshold must be a finite number' }
  if (!THRESHOLD_DECIMAL_PATTERN.test(text)) return { kind: 'usageError', reason: THRESHOLD_RANGE_ERROR }
  const threshold = Number(text)
  if (!Number.isFinite(threshold)) return { kind: 'usageError', reason: 'threshold must be a finite number' }
  return threshold
}

const resolveRunDeps = (deps: ChangedFilesRunDeps | undefined): ChangedFilesRunDeps => {
  if (deps === undefined) return defaultRunDeps
  return deps
}

export const parseChangedFilesCliArgs = (argv: readonly string[]): ChangedFilesCliArgs => {
  const knownFlags = ['--base=', '--threshold=', '--no-ratchet', '--verbose', '--update-baseline']
  const unknownArg = argv.find((arg) => arg.startsWith('-') && !knownFlags.some((f) => arg.startsWith(f)))
  if (unknownArg !== undefined) return { kind: 'usageError', reason: `unknown argument ${unknownArg}` }
  const positionalArg = argv.find((arg) => !knownFlags.some((f) => arg.startsWith(f) || arg === f.replace('=', '')))
  if (positionalArg !== undefined) {
    return { kind: 'usageError', reason: `unexpected positional argument ${positionalArg}` }
  }

  const baseArgs = argv.filter((arg) => arg.startsWith('--base='))
  if (baseArgs.length > 1) return { kind: 'usageError', reason: 'base must be provided at most once' }
  const thresholdArgs = argv.filter((arg) => arg.startsWith('--threshold='))
  if (thresholdArgs.length > 1) return { kind: 'usageError', reason: 'threshold must be provided at most once' }

  const baseArg = baseArgs[0]
  const baseRef = baseArg === undefined ? DEFAULT_BASE_REF : baseArg.slice('--base='.length)
  if (baseRef === '') return { kind: 'usageError', reason: 'base must not be empty' }

  const thresholdArg = thresholdArgs[0]
  const threshold = parseThreshold(thresholdArg === undefined ? undefined : thresholdArg.slice('--threshold='.length))
  if (typeof threshold !== 'number') return threshold

  return {
    kind: 'ok',
    baseRef,
    threshold,
    noRatchet: argv.includes('--no-ratchet'),
    verbose: argv.includes('--verbose'),
    updateBaseline: argv.includes('--update-baseline'),
  }
}

export const changedFilesRun = async (input: ChangedFilesRunInput): Promise<PairedRunResult | null> => {
  const deps = resolveRunDeps(input.deps)
  const targets = deps.selectTargets(input.baseRef, input.projectRoot)
  if (targets.length === 0) {
    deps.log(`No changed mutation targets vs ${input.baseRef}; nothing to measure.`)
    return Promise.resolve(null)
  }

  deps.log(`Changed mutation targets vs ${input.baseRef}:`)
  targets.forEach((target) => {
    deps.log(`- ${target}`)
  })
  const result = await deps.runPaired({
    projectRoot: input.projectRoot,
    reportDir: input.reportDir,
    sourceFiles: targets,
    verbose: input.verbose === true,
    deps: undefined,
  })
  for (const entry of result.perFile) {
    if (entry.merged.scored === 0) continue
    if (input.baseline[entry.sourceFile] === undefined) {
      deps.log(
        `First measurement for ${entry.sourceFile}: score ${entry.merged.score.toFixed(4)} — seeded; future PRs enforce ≥ this.`,
      )
    }
  }
  return result
}

/**
 * Seed the baseline from a changed-files run, PRESERVING existing entries for
 * files that were not re-measured (unlike a full-run ratchet). Used by the
 * master seed command (`--update-baseline`): measures only changed files but
 * must not erase the rest of the baseline. Returns the resulting entry count.
 */
export const seedBaseline = (baselinePath: string, perFile: readonly PerFileScore[]): number => {
  const existing = loadBaseline(baselinePath) ?? {}
  const latest = buildBaselineFromPerFile(perFile)
  const merged = seedMerge(existing, latest)
  writeBaseline(baselinePath, merged)
  return Object.keys(merged).length
}

/**
 * Master seed flow: ratchet the baseline from the run's per-file scores and
 * persist those scores next to the paired reports. The CI commit step replays
 * the scores file onto a fresh master tip whenever the initial push races a
 * concurrent master update, so the Stryker run never has to be repeated.
 * Returns the seeded baseline entry count.
 */
export const runUpdateBaseline = (input: {
  readonly baselinePath: string
  readonly reportDir: string
  readonly perFile: readonly PerFileScore[]
}): number => {
  const count = seedBaseline(input.baselinePath, input.perFile)
  writeScoresFile(path.join(input.reportDir, SCORES_FILE), input.perFile)
  return count
}

const main = async (bun: BunLike): Promise<number> => {
  const parsed = parseChangedFilesCliArgs(bun.argv.slice(2))
  if (parsed.kind === 'usageError') {
    console.error(parsed.reason)
    console.error(
      'Usage: bun scripts/mutation/changed-files.ts [--base=REF] [--threshold=N] [--no-ratchet] [--update-baseline] [--verbose]',
    )
    return 2
  }

  const projectRoot = process.cwd()
  const baselinePath = path.join(projectRoot, BASELINE_FILE)
  const reportDir = path.join(projectRoot, DEFAULT_REPORT_DIR)
  const baseline = loadBaseline(baselinePath) ?? {}
  const result = await changedFilesRun({
    projectRoot,
    reportDir,
    baseRef: parsed.baseRef,
    baseline,
    verbose: parsed.verbose,
    deps: undefined,
  })
  if (result === null) {
    return 0
  }

  if (parsed.updateBaseline) {
    const count = runUpdateBaseline({ baselinePath, reportDir, perFile: result.perFile })
    console.log(`Seeded baseline written to ${BASELINE_FILE} (${count} files)`)
    return 0
  }

  if (resolvePairedRunExitCode(result.merged, parsed.threshold) === 1) {
    console.error(`Mutation score ${result.merged.score} is below threshold ${parsed.threshold}`)
    return 1
  }
  if (!parsed.noRatchet) {
    const ratchet = resolveRatchet(result.perFile, baseline)
    if (ratchet.exitCode === 1) {
      console.error(
        `Mutation ratchet regression: ${ratchet.regressions
          .map((r) => `${r.sourceFile} ${r.score.toFixed(4)} < ${r.threshold.toFixed(4)}`)
          .join(', ')}`,
      )
      return 1
    }
  }
  return 0
}

const maybeBun = (globalThis as typeof globalThis & { readonly Bun: BunLike | undefined }).Bun
if (maybeBun !== undefined && import.meta.path === maybeBun.main) {
  process.exit(await main(maybeBun))
}
