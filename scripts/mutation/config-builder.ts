// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type StrykerBunConfig = Record<string, unknown> & {
  testFiles?: string[]
  timeout?: number
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
  const next: PairedStrykerConfig = {
    ...base,
    mutate: [srcFile],
    bun: { ...baseBun, testFiles: [...testFiles] },
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
