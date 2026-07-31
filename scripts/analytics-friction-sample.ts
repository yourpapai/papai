// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Stratified friction-sample CLI. Draws a deterministic seeded sample of
 * mature complete sessions, writes the product/UX output (typed timelines
 * and case tokens only) plus the engineer-only mode-0600 token map, and can
 * destroy the token map at meeting end. Usage:
 *   bun run scripts/analytics-friction-sample.ts --output /abs/sample.json --token-map /abs/map.json
 *     [--per-stratum 3] [--seed weekly] [--destroy-token-map /abs/map.json]
 */

import {
  destroyTokenMap,
  sampleFrictionSessions,
  writeFrictionSampleOutputs,
} from '../src/analytics/jobs/friction-sample.js'
import { closeDrizzleDb, getDrizzleDb } from '../src/db/drizzle.js'

const fail = (message: string): never => {
  console.error(`status=error reason=${message}`)
  process.exit(1)
}

const parseArgs = (
  argv: readonly string[],
): Readonly<{
  outputPath: string
  tokenMapPath: string
  perStratum: number
  seed: string
  destroyPath: string | null
}> => {
  const flags = new Map<string, string>()
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index]
    if (flag === undefined || !flag.startsWith('--')) throw new Error('unknown_flag')
    const value = argv[index + 1]
    if (value === undefined) throw new Error('missing_flag_value')
    flags.set(flag, value)
    index += 1
  }
  const destroyPath = flags.get('--destroy-token-map') ?? null
  const outputPath = flags.get('--output')
  const tokenMapPath = flags.get('--token-map')
  if (destroyPath === null && (outputPath === undefined || tokenMapPath === undefined)) {
    throw new Error('missing_output')
  }
  const perStratum = Number(flags.get('--per-stratum') ?? '3')
  if (!Number.isInteger(perStratum) || perStratum < 0) throw new Error('invalid_per_stratum')
  return {
    outputPath: outputPath ?? '',
    tokenMapPath: tokenMapPath ?? '',
    perStratum,
    seed: flags.get('--seed') ?? 'friction-sample',
    destroyPath,
  }
}

const main = (): void => {
  const args = parseArgs(process.argv.slice(2))
  if (args.destroyPath !== null) {
    destroyTokenMap(args.destroyPath)
    console.log(`status=ok destroyed=${args.destroyPath}`)
    return
  }
  const result = sampleFrictionSessions(
    { nowMs: Date.now(), perStratum: args.perStratum, seed: args.seed },
    { getDrizzleDb },
  )
  writeFrictionSampleOutputs(result, { outputPath: args.outputPath, tokenMapPath: args.tokenMapPath })
  console.log(`status=ok cases=${result.cases.length} output=${args.outputPath} token_map=${args.tokenMapPath}`)
}

try {
  main()
} catch (error) {
  fail(error instanceof Error ? error.message : String(error))
} finally {
  closeDrizzleDb()
}
