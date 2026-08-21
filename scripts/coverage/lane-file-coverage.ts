// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export function coveredSourceFiles(lcov: string): ReadonlyMap<string, number> {
  const covered = new Map<string, number>()
  let source: string | undefined
  for (const line of lcov.split('\n')) {
    if (line.startsWith('SF:')) source = line.slice(3)
    if (source !== undefined && line.startsWith('LH:')) covered.set(source, Number(line.slice(3)))
    if (line === 'end_of_record') source = undefined
  }
  return covered
}

export function assertCoveredSourceFiles(lcov: string, required: readonly string[]): void {
  const covered = coveredSourceFiles(lcov)
  const missing = required.filter((file) => (covered.get(file) ?? 0) === 0)
  if (missing.length > 0) throw new Error(`Expected non-zero line coverage: ${missing.join(', ')}`)
}

async function main(): Promise<void> {
  const lcovPath = Bun.argv[2]
  const required = Bun.argv.slice(3)
  if (lcovPath === undefined || required.length === 0) {
    throw new Error('Usage: bun scripts/coverage/lane-file-coverage.ts <lcov-path> <required-source-file>...')
  }
  const lcov = await Bun.file(lcovPath).text()
  assertCoveredSourceFiles(lcov, required)
  console.log(`Checked ${required.length} required source file${required.length === 1 ? '' : 's'}`)
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  })
}
