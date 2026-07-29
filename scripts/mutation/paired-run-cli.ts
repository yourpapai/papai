// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { MergedScore } from './score-merger.js'

export type PairedRunCliArgs =
  | {
      readonly kind: 'ok'
      readonly sourceFiles: readonly string[]
      readonly threshold: number
      readonly verbose: boolean
    }
  | { readonly kind: 'usageError'; readonly reason: string }

const THRESHOLD_DECIMAL_PATTERN = /^(0(?:\.\d+)?|1(?:\.0+)?)$/u
const THRESHOLD_RANGE_ERROR = 'threshold must be a decimal number between 0 and 1'

export const parsePairedRunCliArgs = (argv: readonly string[]): PairedRunCliArgs => {
  const unknownArg = argv.find((arg) => arg.startsWith('-') && !arg.startsWith('--threshold=') && arg !== '--verbose')
  if (unknownArg !== undefined) {
    return { kind: 'usageError', reason: `unknown argument ${unknownArg}` }
  }
  const thresholdArgs = argv.filter((arg) => arg.startsWith('--threshold='))
  if (thresholdArgs.length > 1) {
    return { kind: 'usageError', reason: 'threshold must be provided at most once' }
  }
  const thresholdArg = thresholdArgs[0]
  const thresholdText = thresholdArg === undefined ? undefined : thresholdArg.slice('--threshold='.length)
  if (thresholdText === '') {
    return { kind: 'usageError', reason: 'threshold must be a finite number' }
  }
  if (thresholdText !== undefined && !THRESHOLD_DECIMAL_PATTERN.test(thresholdText)) {
    return { kind: 'usageError', reason: THRESHOLD_RANGE_ERROR }
  }
  const threshold = thresholdText === undefined ? 0 : Number(thresholdText)
  if (!Number.isFinite(threshold)) {
    return { kind: 'usageError', reason: 'threshold must be a finite number' }
  }
  const verbose = argv.includes('--verbose')
  return {
    kind: 'ok',
    sourceFiles: argv.filter((arg) => !arg.startsWith('--threshold=') && arg !== '--verbose'),
    threshold,
    verbose,
  }
}

export const resolvePairedRunCliUsageExitCode = (parsed: PairedRunCliArgs): number | null =>
  parsed.kind === 'usageError' || parsed.sourceFiles.length === 0 ? 2 : null

export const resolvePairedRunExitCode = (merged: MergedScore, threshold: number): number =>
  merged.score < threshold ? 1 : 0
