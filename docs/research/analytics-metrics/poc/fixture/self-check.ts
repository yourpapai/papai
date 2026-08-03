// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { Database } from 'bun:sqlite'

import { runEvidenceChecks } from './self-check-evidence.js'

export interface ExpectedSummary {
  readonly seed: string
  readonly day_count: number
  readonly actor_count: number
  readonly platforms: readonly string[]
  readonly context_types: readonly string[]
  readonly actor_roles: readonly string[]
  readonly task_providers: readonly string[]
  readonly invocation_modes: readonly string[]
  readonly activation_actor_counts: Readonly<Record<string, number>>
  readonly retention_actor_counts: Readonly<{ d1: number; d7: number; d30: number }>
  readonly out_of_order_ratio: Readonly<{ minimum: number; maximum: number }>
}

type CliResult =
  | Readonly<{ ok: true; databasePath: string; expectedPath: string }>
  | Readonly<{ ok: false; message: string }>
type ParseResult<Value> = Readonly<{ ok: true; value: Value }> | Readonly<{ ok: false; message: string }>

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isStringArray = (value: unknown): value is readonly string[] =>
  Array.isArray(value) && value.every((entry) => typeof entry === 'string')

const isNumberRecord = (value: unknown): value is Readonly<Record<string, number>> =>
  isRecord(value) && Object.values(value).every((entry) => typeof entry === 'number')

function isExpectedSummary(value: unknown): value is ExpectedSummary {
  if (!isRecord(value)) return false
  const retention = value['retention_actor_counts']
  const ordering = value['out_of_order_ratio']
  return (
    typeof value['seed'] === 'string' &&
    typeof value['day_count'] === 'number' &&
    typeof value['actor_count'] === 'number' &&
    isStringArray(value['platforms']) &&
    isStringArray(value['context_types']) &&
    isStringArray(value['actor_roles']) &&
    isStringArray(value['task_providers']) &&
    isStringArray(value['invocation_modes']) &&
    isNumberRecord(value['activation_actor_counts']) &&
    isRecord(retention) &&
    typeof retention['d1'] === 'number' &&
    typeof retention['d7'] === 'number' &&
    typeof retention['d30'] === 'number' &&
    isRecord(ordering) &&
    typeof ordering['minimum'] === 'number' &&
    typeof ordering['maximum'] === 'number'
  )
}

function parseExpectedSummary(value: unknown): ParseResult<ExpectedSummary> {
  return isExpectedSummary(value)
    ? { ok: true, value }
    : { ok: false, message: 'Expected summary has an invalid contract' }
}

function parseCli(args: readonly string[]): CliResult {
  if (
    args.length === 4 &&
    args[0] === '--database' &&
    args[1] !== undefined &&
    args[1].length > 0 &&
    args[2] === '--expected' &&
    args[3] !== undefined &&
    args[3].length > 0
  ) {
    return { ok: true, databasePath: args[1], expectedPath: args[3] }
  }
  return {
    ok: false,
    message: 'Usage: bun self-check.ts --database /path/to/analytics.sqlite --expected expected-summary.json',
  }
}

async function main(): Promise<number> {
  const cli = parseCli(Bun.argv.slice(2))
  if (!cli.ok) {
    console.error(cli.message)
    return 1
  }
  const [databaseExists, expectedExists] = await Promise.all([
    Bun.file(cli.databasePath).exists(),
    Bun.file(cli.expectedPath).exists(),
  ])
  if (!databaseExists || !expectedExists) {
    console.error('Database and expected-summary files must both exist')
    return 1
  }

  const parsedJson: unknown = JSON.parse(await Bun.file(cli.expectedPath).text())
  const expected = parseExpectedSummary(parsedJson)
  if (!expected.ok) {
    console.error(expected.message)
    return 1
  }

  using database = new Database(cli.databasePath, { readonly: true, strict: true })
  const failures = runEvidenceChecks(database, expected.value)
  if (failures.length > 0) {
    console.error(`Fixture self-check failed with ${failures.length} issue(s):`)
    failures.slice(0, 25).forEach((failure) => {
      console.error(`- ${failure}`)
    })
    return 1
  }
  console.log(JSON.stringify({ databasePath: cli.databasePath, status: 'ok' }))
  return 0
}

process.exitCode = await main()
