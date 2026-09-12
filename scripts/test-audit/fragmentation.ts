// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Fragmentation audit (design tests-consolidation D3): read-only static analysis over
 * the unit-test lane. Pure regex counting over an injected fs deps interface, mirroring
 * scripts/test/import-graph.ts so the module is exercisable against an in-memory file map.
 *
 * Heuristic v2 — counted identically before and after any rewrite so comparisons are
 * internally consistent; v2 numbers are not comparable with v1 figures:
 * - cases: `test(`/`it(` call sites with a literal first argument, plus `test.each(`/`it.each(`
 *   row generators at their literal row count when the rows are a static array literal
 *   (1 when computed);
 * - matcher calls: `expect(`, `node:assert` `assert.*(`, `schemaValidates(`, `expectAppError(`
 *   attributed to the enclosing case segment (a textual call-site count — a grouped
 *   `assertEach` rewrite collapses N per-row sites into one shared callback by construction,
 *   which is the fragmentation signal, never the preservation discriminator).
 */

/** Bump when the counting heuristic changes; before/after pairs must share a version. */
export const HEURISTIC_VERSION = 2

/** Glob covering the unit-test lane's case-bearing files. */
export const AUDIT_SCAN_PATTERN = 'tests/**/*.test.ts'

/** Trees outside the unit-test lane (bunfig-excluded or lane-contracted), never consolidation material. */
export const EXCLUDED_TREES: readonly string[] = [
  'tests/stories/',
  'tests/e2e/',
  'tests/client/',
  'tests/visual/',
  'tests/operational/',
  'tests/smoke/',
  'tests/platform/',
]

/**
 * Every filesystem touch the audit needs, injected so the module is exercisable against an
 * in-memory file map. All paths are repo-relative, POSIX-separated.
 */
export interface AuditDeps {
  /** Repo-relative paths matching {@link AUDIT_SCAN_PATTERN}. */
  readonly scan: (pattern: string) => Iterable<string>
  /** File contents, or `null` when the file is unreadable/absent. */
  readonly read: (relPath: string) => string | null
  /** Whether a repo-relative path exists. */
  readonly exists: (relPath: string) => boolean
}

export interface FileFragmentation {
  readonly file: string
  readonly caseCount: number
  readonly matcherCallCount: number
  /** Share of cases whose segment wraps at most one matcher call, 0..1. */
  readonly singleOrZeroAssertShare: number
}

export interface FragmentationTotals {
  readonly files: number
  readonly caseCount: number
  readonly matcherCallCount: number
  readonly singleOrZeroAssertShare: number
}

export interface FragmentationReport {
  readonly heuristicVersion: number
  readonly files: readonly FileFragmentation[]
  readonly totals: FragmentationTotals
}

/** `test(`/`it(` with a literal first argument: bare call site (no property access), quoted name. */
const CASE_SITE_PATTERN = /(?:^|[^\w.$])(?:test|it)\s*\(\s*['"`]/gmu

/** `test.each(`/`it.each(` row-generator sites (bare call site); tagged-template rows count as computed. */
const EACH_SITE_PATTERN = /(?:^|[^\w.$])(?:test|it)\.each\s*[(`]/gmu

/** Matcher call sites: expect(, assert.*(, schemaValidates(, expectAppError( — bare call sites only. */
const MATCHER_CALL_PATTERN =
  /(?:^|[^\w.$])(?:expect|schemaValidates|expectAppError)\s*\(|(?:^|[^\w.$])assert\.\w+\s*\(/gmu

const isExcluded = (file: string): boolean => EXCLUDED_TREES.some((tree) => file.startsWith(tree))

/** Index just past a quoted string literal starting at `index` (its opening quote). */
const skipQuoted = (source: string, index: number): number => {
  const quote = source[index] ?? ''
  let cursor = index + 1
  while (cursor < source.length) {
    const inner = source[cursor] ?? ''
    if (inner === '\\') cursor += 2
    else if (inner === quote) break
    else cursor += 1
  }
  return cursor + 1
}

/**
 * Top-level element count of a static array literal, or `null` when the argument is anything
 * else (identifier, call, tagged template) — computed rows count as a single case.
 */
const countArrayRows = (source: string, openIndex: number): number | null => {
  let index = openIndex
  while (index < source.length && /\s/u.test(source[index] ?? '')) index += 1
  if (source[index] !== '[') return null
  let depth = 0
  let rows = 0
  let inElement = false
  while (index < source.length) {
    const char = source[index] ?? ''
    if (char === '"' || char === "'" || char === '`') {
      if (depth === 1 && !inElement) {
        rows += 1
        inElement = true
      }
      index = skipQuoted(source, index)
      continue
    }
    if (char === '[' || char === '(' || char === '{') {
      depth += 1
      if (depth === 2 && !inElement) {
        rows += 1
        inElement = true
      }
      index += 1
      continue
    }
    if (char === ']' || char === ')' || char === '}') {
      depth -= 1
      if (depth === 0) return rows
      index += 1
      continue
    }
    if (char === ',') {
      if (depth === 1) inElement = false
      index += 1
      continue
    }
    if (depth === 1 && !inElement && /\S/u.test(char)) {
      rows += 1
      inElement = true
    }
    index += 1
  }
  return null
}

interface CaseSite {
  /** Index in the source where this case's segment starts (the call site). */
  readonly start: number
  /** Runner cases this site registers (1 for literal-name calls, row count or 1 for .each). */
  readonly weight: number
}

interface CaseSegment extends CaseSite {
  /** Index where the next case segment starts, or source length for the final segment. */
  readonly end: number
  /** Matcher call sites inside [start, end). */
  readonly matcherCalls: number
}

const scanCaseSites = (source: string): CaseSite[] => {
  const sites: CaseSite[] = []

  const eachMatches = [...source.matchAll(EACH_SITE_PATTERN)]
  const eachSpans: ReadonlyArray<readonly [number, number]> = eachMatches.map((match) => {
    const start = match.index ?? 0
    const open = start + match[0].length - 1
    const rows = (match[0].endsWith('(') ? countArrayRows(source, open + 1) : null) ?? 1
    sites.push({ start, weight: rows })
    return [start, open] as const
  })
  const inEachRows = (index: number): boolean => eachSpans.some(([start, end]) => index >= start && index <= end)

  for (const match of source.matchAll(CASE_SITE_PATTERN)) {
    const start = match.index ?? 0
    if (inEachRows(start)) continue
    sites.push({ start, weight: 1 })
  }

  return sites.sort((a, b) => a.start - b.start)
}

const segmentCaseSites = (source: string): CaseSegment[] => {
  const sites = scanCaseSites(source)
  return sites.map((site, position) => {
    const end = position + 1 < sites.length ? (sites[position + 1]?.start ?? source.length) : source.length
    const segment = source.slice(site.start, end)
    const matcherCalls = [...segment.matchAll(MATCHER_CALL_PATTERN)].length
    return { ...site, end, matcherCalls }
  })
}

const auditFile = (file: string, source: string): FileFragmentation | null => {
  const segments = segmentCaseSites(source)
  if (segments.length === 0) return null
  const caseCount = segments.reduce((sum, segment) => sum + segment.weight, 0)
  const matcherCallCount = segments.reduce((sum, segment) => sum + segment.matcherCalls, 0)
  const singleOrZero = segments.reduce((sum, segment) => sum + (segment.matcherCalls <= 1 ? segment.weight : 0), 0)
  return {
    file,
    caseCount,
    matcherCallCount,
    singleOrZeroAssertShare: caseCount === 0 ? 0 : singleOrZero / caseCount,
  }
}

/** Build the fragmentation report over {@link AUDIT_SCAN_PATTERN} minus {@link EXCLUDED_TREES}. */
export function auditFragmentation(deps: AuditDeps): FragmentationReport {
  const files: FileFragmentation[] = []
  const scanned = [...deps.scan(AUDIT_SCAN_PATTERN)].filter((file) => !isExcluded(file)).sort()
  for (const file of scanned) {
    const content = deps.read(file)
    if (content === null) continue
    const entry = auditFile(file, content)
    if (entry !== null) files.push(entry)
  }
  const caseCount = files.reduce((sum, entry) => sum + entry.caseCount, 0)
  const matcherCallCount = files.reduce((sum, entry) => sum + entry.matcherCallCount, 0)
  const singleOrZero = files.reduce((sum, entry) => sum + entry.singleOrZeroAssertShare * entry.caseCount, 0)
  return {
    heuristicVersion: HEURISTIC_VERSION,
    files,
    totals: {
      files: files.length,
      caseCount,
      matcherCallCount,
      singleOrZeroAssertShare: caseCount === 0 ? 0 : singleOrZero / caseCount,
    },
  }
}
