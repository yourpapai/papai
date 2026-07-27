// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const STORY_SCOPE_ROOTS: readonly string[] = ['src', 'plugins']

const TESTING_DOUBLE_SUFFIX = '.testing.ts'

/**
 * In scope: TypeScript under a scope root, excluding `*.testing.ts` doubles.
 * Those are test support that lives under `src/` only for import-path
 * convenience, so counting them while excluding `tests/**` would be incoherent.
 */
export function isScopedSourceFile(filePath: string): boolean {
  if (!filePath.endsWith('.ts') || filePath.endsWith(TESTING_DOUBLE_SUFFIX)) return false
  return STORY_SCOPE_ROOTS.some((root) => filePath.startsWith(`${root}/`))
}

export type ScopedLcov = Readonly<{
  lcov: string
  measured: readonly string[]
  seeded: readonly string[]
}>

/**
 * A seeded file contributes exactly 0 to the per-file mean regardless of its
 * real line count, and `pct` is the only field the gate, the ratchet, and the
 * formatter read. The pooled `found`/`hit` totals therefore under-report
 * unloaded files — preferred over inventing counts the coverage tool never
 * produced.
 */
const SEEDED_RECORD_BODY: readonly string[] = ['FNF:1', 'FNH:0', 'LF:1', 'LH:0', 'end_of_record']

function splitRecords(lcov: string): readonly string[] {
  const records: string[] = []
  let current: string[] = []
  for (const line of lcov.split('\n')) {
    current.push(line)
    if (line.trim() === 'end_of_record') {
      records.push(current.join('\n'))
      current = []
    }
  }
  return records
}

function recordSourceFile(record: string): string | undefined {
  for (const raw of record.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('SF:')) return line.slice('SF:'.length)
  }
  return undefined
}

/**
 * Pure. Drops out-of-scope records and appends a zero record for every
 * in-scope source file the run never loaded, so never-imported code counts as
 * 0% instead of vanishing from the mean.
 */
export function scopeLcov(lcov: string, sourceFiles: readonly string[]): ScopedLcov {
  const kept: string[] = []
  const measured: string[] = []
  for (const record of splitRecords(lcov)) {
    const file = recordSourceFile(record)
    if (file === undefined || !isScopedSourceFile(file)) continue
    kept.push(record)
    measured.push(file)
  }
  const loaded = new Set(measured)
  const seeded = sourceFiles.filter((file) => isScopedSourceFile(file) && !loaded.has(file)).toSorted()
  for (const file of seeded) kept.push([`SF:${file}`, ...SEEDED_RECORD_BODY].join('\n'))
  return { lcov: kept.length === 0 ? '' : `${kept.join('\n')}\n`, measured, seeded }
}

export function formatStoryCoverageScope(scoped: ScopedLcov): string {
  const total = scoped.measured.length + scoped.seeded.length
  return `  scope: ${scoped.measured.length} measured, ${scoped.seeded.length} unloaded seeded as 0%, ${total} files`
}
