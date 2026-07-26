// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.
import { applyThreshold, nextFloor, parseBunfigThreshold, parseLcovTotals } from './ratchet-lib.js'

const LCOV_PATH = 'reports/coverage/lcov.info'
const BUNFIG_PATH = 'bunfig.toml'
const EPSILON = 0.005

async function main(): Promise<void> {
  const update = process.argv.includes('--update')
  const lcovFile = Bun.file(LCOV_PATH)
  if (!(await lcovFile.exists())) {
    throw new Error(`${LCOV_PATH} not found; run "bun test --coverage" first to generate it`)
  }
  const lcov = await lcovFile.text()
  const toml = await Bun.file(BUNFIG_PATH).text()
  const totals = parseLcovTotals(lcov)
  const floor = parseBunfigThreshold(toml)

  const pct = (n: number): string => `${(n * 100).toFixed(2)}%`
  console.log(`measured: lines ${pct(totals.lines.pct)}, functions ${pct(totals.functions.pct)}`)
  console.log(`floor:    lines ${pct(floor.lines)}, functions ${pct(floor.functions)}`)

  if (update) {
    const next = {
      lines: nextFloor(floor.lines, totals.lines.pct, EPSILON),
      functions: nextFloor(floor.functions, totals.functions.pct, EPSILON),
    }
    if (next.lines === floor.lines && next.functions === floor.functions) {
      console.log('no improvement beyond epsilon; floor unchanged')
      return
    }
    await Bun.write(BUNFIG_PATH, applyThreshold(toml, next))
    console.log(`floor raised to lines ${pct(next.lines)}, functions ${pct(next.functions)}`)
    return
  }

  if (totals.lines.pct < floor.lines || totals.functions.pct < floor.functions) {
    console.error('coverage below committed floor')
    process.exit(1)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
