// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import path from 'node:path'

export interface CliOptions {
  readonly baseUrl: string
  readonly clientId: string
  readonly concurrency: number
  readonly evidencePath?: string
  readonly ledgerPath: string
  readonly maxAttempts: number
  readonly simulateAmbiguousSuccesses: number
  readonly sinkId: string
  readonly sourcePath: string
  readonly timeoutMs: number
}

export type CliParseResult =
  | Readonly<{ ok: true; value: CliOptions }>
  | Readonly<{
      code:
        | 'DUPLICATE_ARGUMENT'
        | 'INVALID_NUMBER'
        | 'LEDGER_MUST_BE_SEPARATE'
        | 'MISSING_ARGUMENT'
        | 'PATH_MUST_BE_ABSOLUTE'
        | 'UNKNOWN_ARGUMENT'
      ok: false
    }>

const ALLOWED_ARGUMENTS: ReadonlySet<string> = new Set([
  '--base-url',
  '--client-id',
  '--concurrency',
  '--evidence',
  '--ledger',
  '--max-attempts',
  '--simulate-ambiguous-successes',
  '--sink-id',
  '--source',
  '--timeout-ms',
])

function argumentEntries(args: readonly string[]): readonly (readonly [string, string])[] | null {
  if (args.length % 2 !== 0) return null
  return Array.from({ length: args.length / 2 }, (_, index) => {
    const key = args[index * 2] ?? ''
    const value = args[index * 2 + 1] ?? ''
    return [key, value] as const
  })
}

function integerValue(
  values: Readonly<Record<string, string>>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number | null {
  const raw = values[key]
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null
}

function pathsAreAbsolute(paths: readonly (string | undefined)[]): boolean {
  return paths.every((value) => value === undefined || path.isAbsolute(value))
}

type NumericOptions = Pick<CliOptions, 'concurrency' | 'maxAttempts' | 'simulateAmbiguousSuccesses' | 'timeoutMs'>

function numericOptions(values: Readonly<Record<string, string>>): NumericOptions | null {
  const concurrency = integerValue(values, '--concurrency', 8, 1, 32)
  const maxAttempts = integerValue(values, '--max-attempts', 3, 1, 10)
  const simulateAmbiguousSuccesses = integerValue(values, '--simulate-ambiguous-successes', 0, 0, 10_000)
  const timeoutMs = integerValue(values, '--timeout-ms', 10_000, 1, 60_000)
  return [concurrency, maxAttempts, simulateAmbiguousSuccesses, timeoutMs].includes(null)
    ? null
    : {
        concurrency: concurrency ?? 8,
        maxAttempts: maxAttempts ?? 3,
        simulateAmbiguousSuccesses: simulateAmbiguousSuccesses ?? 0,
        timeoutMs: timeoutMs ?? 10_000,
      }
}

export function parseCliOptions(args: readonly string[]): CliParseResult {
  const entries = argumentEntries(args)
  if (entries === null) return { code: 'MISSING_ARGUMENT', ok: false }
  if (entries.some(([key]) => !ALLOWED_ARGUMENTS.has(key))) {
    return { code: 'UNKNOWN_ARGUMENT', ok: false }
  }
  const keys = entries.map(([key]) => key)
  if (new Set(keys).size !== keys.length) return { code: 'DUPLICATE_ARGUMENT', ok: false }
  const values: Readonly<Record<string, string>> = Object.fromEntries(entries)
  const sourcePath = values['--source']
  const ledgerPath = values['--ledger']
  const clientId = values['--client-id']
  if (sourcePath === undefined || ledgerPath === undefined || clientId === undefined) {
    return { code: 'MISSING_ARGUMENT', ok: false }
  }
  const evidencePath = values['--evidence']
  if (!pathsAreAbsolute([sourcePath, ledgerPath, evidencePath])) {
    return { code: 'PATH_MUST_BE_ABSOLUTE', ok: false }
  }
  if (sourcePath === ledgerPath) return { code: 'LEDGER_MUST_BE_SEPARATE', ok: false }
  const numeric = numericOptions(values)
  if (numeric === null) return { code: 'INVALID_NUMBER', ok: false }
  return {
    ok: true,
    value: {
      baseUrl: values['--base-url'] ?? 'http://127.0.0.1:4400',
      clientId,
      ...(evidencePath === undefined ? {} : { evidencePath }),
      ledgerPath,
      ...numeric,
      sinkId: values['--sink-id'] ?? 'openpanel-local',
      sourcePath,
    },
  }
}
