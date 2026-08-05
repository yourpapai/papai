// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type StrykerBunConfig = Record<string, unknown> & {
  testFiles?: string[]
  bunArgs?: string[]
  timeout?: number
}

/**
 * Normalize a test file path so Bun treats it as a path, not a pattern.
 * Without the "./" prefix, Bun applies pathIgnorePatterns during discovery
 * and silently drops tests/client/** entries in the Stryker sandbox.
 */
export const toRelativeTestFilePath = (p: string): string => (p.startsWith('./') || p.startsWith('/') ? p : `./${p}`)

/**
 * Extra bun CLI flags the tests/client/ and tests/e2e/ lanes need inside the
 * Stryker sandbox. Two distinct problems:
 *
 * 1. Discovery — both lanes are excluded by bunfig.toml pathIgnorePatterns, and
 *    the stryker-bun-runner copies pathIgnorePatterns into the sanitized sandbox
 *    bunfig, so `--path-ignore-patterns ''` is needed to clear it.
 * 2. Execution mode — each lane's package.json script passes a setup preload
 *    (and, for the client lane, `--conditions=browser`, without which msw
 *    resolves to its node export and the handler suites fail unmutated). A lane
 *    whose tests fail on the unmutated code aborts the whole file with a
 *    ConfigError, which the paired run records as `errored` rather than a score.
 */
const laneBunArgs = (testFiles: string[]): string[] => {
  const args: string[] = []
  if (testFiles.some((f) => f.includes('tests/client/'))) {
    args.push('--conditions=browser', '--preload', './tests/client-setup.ts')
  }
  if (testFiles.some((f) => f.includes('tests/e2e/'))) {
    args.push('--preload', './tests/e2e/bun-test-setup.ts')
  }
  if (args.length > 0) args.push('--path-ignore-patterns', '')
  return args
}

export type StrykerConfig = Record<string, unknown> & {
  appendPlugins?: string[]
  bun?: StrykerBunConfig
  checkers?: string[]
  ignorePatterns?: string[]
  mutate?: string[]
  reporters?: string[]
  jsonReporter?: { fileName: string }
  htmlReporter?: { fileName: string }
  thresholds?: { high: number; low: number; break: number }
  ignoreStatic?: boolean
  incremental?: boolean
  tsconfigFile?: string
}

export type PairedStrykerConfig = StrykerConfig & {
  bun: StrykerBunConfig & { testFiles: string[] }
  jsonReporter: { fileName: string }
  thresholds: { high: number; low: number; break: number }
}

export interface BuildPairedConfigInput {
  base: StrykerConfig
  srcFile: string
  testFiles: string[]
  reportPath: string
}

/**
 * Build an ephemeral Stryker config for a single source file paired with a
 * specific test set. Forces ignoreStatic:false (the accurate mode), narrows
 * the test set via bun.testFiles, and routes the JSON report to a per-file
 * path so the score-merger can aggregate cleanly.
 */
export function buildPairedConfig(input: BuildPairedConfigInput): PairedStrykerConfig {
  const { base, srcFile, testFiles, reportPath } = input
  if (testFiles.length === 0) {
    throw new Error(`buildPairedConfig: testFiles must not be empty for ${srcFile}`)
  }

  const baseBun = base.bun ?? {}
  const baseThresholds = base.thresholds ?? { high: 80, low: 60, break: 0 }
  const normalizedTestFiles = testFiles.map(toRelativeTestFilePath)
  const baseBunArgs = Array.isArray(baseBun.bunArgs) ? baseBun.bunArgs : []
  const bunArgs = [...baseBunArgs, ...laneBunArgs(normalizedTestFiles)]
  const resolvedBun: StrykerBunConfig & { testFiles: string[] } = {
    ...baseBun,
    testFiles: normalizedTestFiles,
    ...(bunArgs.length > 0 ? { bunArgs } : {}),
  }
  const next: PairedStrykerConfig = {
    ...base,
    mutate: [srcFile],
    bun: resolvedBun,
    ignoreStatic: false,
    incremental: false,
    reporters: ['json'],
    jsonReporter: { fileName: reportPath },
    thresholds: { ...baseThresholds, break: 0 },
  }
  // The HTML reporter only makes sense for the whole-repo run.
  delete (next as Record<string, unknown>)['htmlReporter']
  // The incremental file would be reused across paired runs and corrupt them.
  delete (next as Record<string, unknown>)['incrementalFile']
  return next
}
