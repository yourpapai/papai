// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { DEFAULT_SHARD_CAP } from './shard-sizing.js'

/**
 * Argument parsing for the three-stage mutation gate: `plan`, `shard`, `gate`.
 *
 * Value flags match by prefix (they carry `=value`); boolean flags match EXACTLY. Matching
 * booleans by prefix would quietly accept `--no-score-caches` and ignore it — a mistyped flag
 * that silently fails to apply is the worst outcome for a gate, because the run still goes green
 * while doing something other than what was asked. Same rule as `changed-files.ts`.
 */
export type ShardCliArgs =
  | {
      readonly kind: 'plan'
      readonly baseRef: string
      readonly cap: number
      readonly noScoreCache: boolean
      readonly out: string
    }
  | {
      readonly kind: 'shard'
      readonly shardIndex: number
      readonly plan: string
      readonly out: string
      readonly verbose: boolean
    }
  | {
      readonly kind: 'gate'
      readonly plan: string
      readonly resultsDir: string
      readonly threshold: number
      readonly noRatchet: boolean
    }
  | { readonly kind: 'usageError'; readonly reason: string }

export const DEFAULT_PLAN_PATH = 'reports/paired/shard-plan.json'
export const DEFAULT_RESULTS_DIR = 'reports/paired/shards'

const VALUE_FLAGS = ['--base=', '--cap=', '--index=', '--plan=', '--out=', '--results=', '--threshold=']
const BOOLEAN_FLAGS = ['--no-score-cache', '--no-ratchet', '--verbose']
const THRESHOLD_PATTERN = /^(0(?:\.\d+)?|1(?:\.0+)?)$/u
const POSITIVE_INT_PATTERN = /^[1-9]\d*$/u
const NON_NEGATIVE_INT_PATTERN = /^(0|[1-9]\d*)$/u

const usage = (reason: string): ShardCliArgs => ({ kind: 'usageError', reason })

const valueOf = (argv: readonly string[], flag: string): string | undefined => {
  const found = argv.find((arg) => arg.startsWith(flag))
  return found === undefined ? undefined : found.slice(flag.length)
}

const isKnownArg = (arg: string): boolean =>
  VALUE_FLAGS.some((flag) => arg.startsWith(flag)) || BOOLEAN_FLAGS.includes(arg)

const parsePlan = (argv: readonly string[]): ShardCliArgs => {
  const baseRef = valueOf(argv, '--base=') ?? 'origin/master'
  if (baseRef === '') return usage('base must not be empty')
  const capText = valueOf(argv, '--cap=')
  if (capText !== undefined && !POSITIVE_INT_PATTERN.test(capText)) return usage('cap must be a positive integer')
  return {
    kind: 'plan',
    baseRef,
    cap: capText === undefined ? DEFAULT_SHARD_CAP : Number(capText),
    noScoreCache: argv.includes('--no-score-cache'),
    out: valueOf(argv, '--out=') ?? DEFAULT_PLAN_PATH,
  }
}

const parseShard = (argv: readonly string[]): ShardCliArgs => {
  const indexText = valueOf(argv, '--index=')
  if (indexText === undefined) return usage('shard requires --index=N')
  if (!NON_NEGATIVE_INT_PATTERN.test(indexText)) return usage('index must be a non-negative integer')
  const shardIndex = Number(indexText)
  return {
    kind: 'shard',
    shardIndex,
    plan: valueOf(argv, '--plan=') ?? DEFAULT_PLAN_PATH,
    out: valueOf(argv, '--out=') ?? `${DEFAULT_RESULTS_DIR}/shard-${shardIndex}.json`,
    verbose: argv.includes('--verbose'),
  }
}

const parseGate = (argv: readonly string[]): ShardCliArgs => {
  const thresholdText = valueOf(argv, '--threshold=')
  if (thresholdText !== undefined && !THRESHOLD_PATTERN.test(thresholdText)) {
    return usage('threshold must be a decimal number between 0 and 1')
  }
  return {
    kind: 'gate',
    plan: valueOf(argv, '--plan=') ?? DEFAULT_PLAN_PATH,
    resultsDir: valueOf(argv, '--results=') ?? DEFAULT_RESULTS_DIR,
    threshold: thresholdText === undefined ? 0 : Number(thresholdText),
    noRatchet: argv.includes('--no-ratchet'),
  }
}

export const parseShardCliArgs = (argv: readonly string[]): ShardCliArgs => {
  const [subcommand, ...rest] = argv
  if (subcommand === undefined) return usage('expected one of: plan, shard, gate')

  const unknown = rest.find((arg) => !isKnownArg(arg))
  if (unknown !== undefined) return usage(`unknown argument ${unknown}`)

  if (subcommand === 'plan') return parsePlan(rest)
  if (subcommand === 'shard') return parseShard(rest)
  if (subcommand === 'gate') return parseGate(rest)
  return usage(`unknown subcommand ${subcommand}`)
}

export const SHARD_CLI_USAGE =
  'Usage: bun scripts/mutation/shard-cli.ts <plan|shard|gate> [--base=REF] [--cap=N] [--index=N] [--plan=PATH] [--out=PATH] [--results=DIR] [--threshold=N] [--no-score-cache] [--no-ratchet] [--verbose]'
