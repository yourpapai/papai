// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFileSync } from 'node:child_process'
import path from 'node:path'

import { isGateableImplFile } from '../../.hooks/tdd/test-resolver.mjs'
import { pairedRun, resolvePairedRunExitCode } from './paired-run.js'

export interface ChangedFilesDeps {
  readonly git: (args: readonly string[]) => string
  readonly isGateableImpl: (relPath: string, projectRoot: string) => boolean
}

export interface SelectInput {
  readonly baseRef: string
  readonly projectRoot: string
  readonly deps?: ChangedFilesDeps
}

type ChangedFilesCliArgs =
  | { readonly kind: 'ok'; readonly baseRef: string; readonly threshold: number }
  | { readonly kind: 'usageError'; readonly reason: string }

type BunLike = {
  readonly argv: readonly string[]
  readonly main: string
}

const DEFAULT_BASE_REF = 'origin/master'
const DEFAULT_REPORT_DIR = 'reports/paired'
const THRESHOLD_DECIMAL_PATTERN = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u
const THRESHOLD_RANGE_ERROR = 'threshold must be a decimal number between 0 and 1'

const defaultDeps: ChangedFilesDeps = {
  git: (args) =>
    execFileSync('git', [...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  isGateableImpl: isGateableImplFile,
}

const resolveDeps = (deps: ChangedFilesDeps | undefined): ChangedFilesDeps => deps ?? defaultDeps

export const selectChangedMutationTargets = (input: SelectInput): string[] => {
  const deps = resolveDeps(input.deps)
  const output = deps.git(['diff', '--name-only', `${input.baseRef}...HEAD`])
  return [
    ...new Set(
      output
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    ),
  ]
    .filter((relPath) => deps.isGateableImpl(relPath, input.projectRoot))
    .sort()
}

const parseThreshold = (text: string | undefined): ChangedFilesCliArgs | number => {
  if (text === undefined) return 0
  if (text === '') return { kind: 'usageError', reason: 'threshold must be a finite number' }
  if (!THRESHOLD_DECIMAL_PATTERN.test(text)) return { kind: 'usageError', reason: THRESHOLD_RANGE_ERROR }
  const threshold = Number(text)
  if (!Number.isFinite(threshold)) return { kind: 'usageError', reason: 'threshold must be a finite number' }
  return threshold
}

const parseChangedFilesCliArgs = (argv: readonly string[]): ChangedFilesCliArgs => {
  const unknownArg = argv.find(
    (arg) => arg.startsWith('-') && !arg.startsWith('--base=') && !arg.startsWith('--threshold='),
  )
  if (unknownArg !== undefined) return { kind: 'usageError', reason: `unknown argument ${unknownArg}` }

  const baseArgs = argv.filter((arg) => arg.startsWith('--base='))
  if (baseArgs.length > 1) return { kind: 'usageError', reason: 'base must be provided at most once' }
  const thresholdArgs = argv.filter((arg) => arg.startsWith('--threshold='))
  if (thresholdArgs.length > 1) return { kind: 'usageError', reason: 'threshold must be provided at most once' }

  const baseRef = baseArgs[0]?.slice('--base='.length) ?? DEFAULT_BASE_REF
  if (baseRef === '') return { kind: 'usageError', reason: 'base must not be empty' }

  const threshold = parseThreshold(thresholdArgs[0]?.slice('--threshold='.length))
  if (typeof threshold !== 'number') return threshold

  return { kind: 'ok', baseRef, threshold }
}

const main = async (bun: BunLike): Promise<number> => {
  const parsed = parseChangedFilesCliArgs(bun.argv.slice(2))
  if (parsed.kind === 'usageError') {
    console.error(parsed.reason)
    console.error('Usage: bun scripts/mutation/changed-files.ts [--base=REF] [--threshold=N]')
    return 2
  }

  const projectRoot = process.cwd()
  const targets = selectChangedMutationTargets({
    baseRef: parsed.baseRef,
    projectRoot,
  })
  if (targets.length === 0) {
    console.log(`No changed mutation targets vs ${parsed.baseRef}; nothing to measure.`)
    return 0
  }

  console.log(`Changed mutation targets vs ${parsed.baseRef}:`)
  targets.forEach((target) => {
    console.log(`- ${target}`)
  })
  const result = await pairedRun({
    projectRoot,
    reportDir: path.join(projectRoot, DEFAULT_REPORT_DIR),
    sourceFiles: targets,
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
