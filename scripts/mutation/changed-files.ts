// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { isGateableImplFile } from '../../.hooks/tdd/test-resolver.mjs'
import { loadBaseline } from './baseline.js'
import type { BaselineMap } from './baseline.js'
import { resolveChangedFilesGates } from './gates.js'
import type { GateInput } from './gates.js'
import {
  combineIncrementalResult,
  formatIncrementalPlan,
  logFirstMeasurements,
  measureOnlyWhatIsNeeded,
} from './incremental-run.js'
import type { IncrementalDeps } from './incremental-run.js'
import { createIncrementalDeps } from './incremental-run.js'
import { pairedRun } from './paired-run.js'
import type { PairedRunInput, PairedRunResult } from './paired-run.js'
import { runUpdateBaseline } from './seed-from.js'

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
      readonly noScoreCache: boolean
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
  /**
   * Carried-over score wiring, or `undefined` to measure every target — which is exactly the
   * behavior this runner had before incremental measurement existed. `--no-score-cache` and
   * `--update-baseline` both resolve to `undefined`.
   */
  readonly incremental: IncrementalDeps | undefined
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

/**
 * Is this a generated module — something under a `generated/` directory?
 *
 * Generated modules are never mutation targets, for two reasons that point the same way.
 *
 * The blocking one: Stryker instruments the file it mutates inside its sandbox, so a test that
 * reads its own implementation's source text off disk sees the instrumented copy and fails —
 * during the INITIAL, unmutated run, which aborts the file with a ConfigError. The paired run
 * then records `errored` instead of a score and the gate goes red. That is exactly what
 * `tests/analytics/tool-slug-generation.test.ts` does, deliberately: it re-renders the module
 * and compares it to the checked-in bytes, proving the generator output has not drifted. The
 * drift guard is worth more than the mutation score, so it is not the half that gives way.
 *
 * The reason that would hold anyway: a generated module's content comes from its generator, so
 * mutating it measures the generator's tests, not this file's. Skipping it costs no real
 * coverage — and stops every PR that adds a tool from failing on a file it only regenerated.
 */
export const isGeneratedSourceFile = (relPath: string): boolean => relPath.split(/[/\\]/u).includes('generated')

export const isLocaleDataFile = (relPath: string): boolean => relPath.startsWith('src/i18n/locales/')

export const selectChangedMutationTargets = (input: SelectInput): string[] => {
  const deps = resolveDeps(input.deps)
  const output = deps.runGit(['diff', '--name-only', '--diff-filter=ACMRT', `${input.baseRef}...HEAD`])
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((relPath) => deps.isGateableImpl(relPath, input.projectRoot))
    .filter((relPath) => !isGeneratedSourceFile(relPath))
    .filter((relPath) => !isLocaleDataFile(relPath))
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

// Value flags match by prefix (they carry `=value`); boolean flags match EXACTLY. Matching
// booleans by prefix too would quietly accept `--no-score-caches` and then ignore it — a
// mistyped flag that silently fails to apply is the worst outcome for a gate, because the run
// still goes green while doing something other than what was asked.
const VALUE_FLAGS = ['--base=', '--threshold=']
const BOOLEAN_FLAGS = ['--no-ratchet', '--verbose', '--update-baseline', '--no-score-cache']

const isKnownArg = (arg: string): boolean =>
  VALUE_FLAGS.some((flag) => arg.startsWith(flag)) || BOOLEAN_FLAGS.includes(arg)

export const parseChangedFilesCliArgs = (argv: readonly string[]): ChangedFilesCliArgs => {
  const unknownArg = argv.find((arg) => arg.startsWith('-') && !isKnownArg(arg))
  if (unknownArg !== undefined) return { kind: 'usageError', reason: `unknown argument ${unknownArg}` }
  const positionalArg = argv.find((arg) => !isKnownArg(arg))
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
    noScoreCache: argv.includes('--no-score-cache'),
  }
}

/**
 * Measure the branch diff and hand the gate its input.
 *
 * The target list is always the WHOLE branch diff vs the base ref — that is what keeps the
 * verdict whole-branch. What the incremental split decides is only which of those targets
 * Stryker is asked to run; the rest arrive from scores recorded by an earlier run on this
 * branch. A regression measured two pushes ago is therefore still in `perFile`, and still
 * fails the gate, even on a push that touched nothing near it.
 */
export const changedFilesRun = async (input: ChangedFilesRunInput): Promise<GateInput | null> => {
  const deps = resolveRunDeps(input.deps)
  const targets = deps.selectTargets(input.baseRef, input.projectRoot)
  if (targets.length === 0) {
    // Still record: the flush writes the store even when empty, so the CI save step always
    // has a file to save rather than warning about a missing path.
    input.incremental?.record([])
    deps.log(`No changed mutation targets vs ${input.baseRef}; nothing to measure.`)
    return null
  }

  deps.log(`Changed mutation targets vs ${input.baseRef}:`)
  targets.forEach((target) => {
    deps.log(`- ${target}`)
  })

  const plan = input.incremental?.plan(targets) ?? { toMeasure: targets, reused: [] }
  if (input.incremental !== undefined) {
    formatIncrementalPlan(plan).forEach((line) => {
      deps.log(line)
    })
  }

  const fresh = await measureOnlyWhatIsNeeded({
    runPaired: deps.runPaired,
    projectRoot: input.projectRoot,
    reportDir: input.reportDir,
    verbose: input.verbose === true,
    toMeasure: plan.toMeasure,
  })
  // Record BEFORE gating. A failing run must still persist what it measured, or the next push
  // re-measures the regression from scratch and the gate forgets it — which is the whole point.
  input.incremental?.record(fresh.perFile)

  const result = combineIncrementalResult({ fresh, reused: plan.reused })
  logFirstMeasurements(result.perFile, input.baseline, deps.log)
  return result
}

const main = async (bun: BunLike): Promise<number> => {
  const parsed = parseChangedFilesCliArgs(bun.argv.slice(2))
  if (parsed.kind === 'usageError') {
    console.error(parsed.reason)
    console.error(
      'Usage: bun scripts/mutation/changed-files.ts [--base=REF] [--threshold=N] [--no-ratchet] [--update-baseline] [--no-score-cache] [--verbose]',
    )
    return 2
  }

  const projectRoot = process.cwd()
  const baselinePath = path.join(projectRoot, BASELINE_FILE)
  const reportDir = path.join(projectRoot, DEFAULT_REPORT_DIR)
  const baseline = loadBaseline(baselinePath) ?? {}
  // Reuse is off for a baseline seed: the committed floor must only ever come from a score
  // measured in the run that seeds it, never from one carried over from an earlier run.
  const reuseDisabled = parsed.noScoreCache || parsed.updateBaseline
  const result = await changedFilesRun({
    projectRoot,
    reportDir,
    baseRef: parsed.baseRef,
    baseline,
    verbose: parsed.verbose,
    incremental: reuseDisabled ? undefined : createIncrementalDeps({ projectRoot, reportDir }),
    deps: undefined,
  })
  if (parsed.updateBaseline) {
    const perFile = result === null ? [] : result.perFile
    const count = runUpdateBaseline({ baselinePath, reportDir, perFile })
    console.log(`Seeded baseline written to ${BASELINE_FILE} (${count} files)`)
    return 0
  }

  if (result === null) {
    return 0
  }

  const verdict = resolveChangedFilesGates({
    result,
    threshold: parsed.threshold,
    noRatchet: parsed.noRatchet,
    baseline,
  })
  if (verdict.message !== null) console.error(verdict.message)
  return verdict.exitCode
}

const maybeBun = (globalThis as typeof globalThis & { readonly Bun: BunLike | undefined }).Bun
if (maybeBun !== undefined && import.meta.path === maybeBun.main) {
  process.exit(await main(maybeBun))
}
