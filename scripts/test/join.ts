// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { LogFailureBlock, LogSegment } from './console-log.js'
import type { JUnitCase, JUnitRun } from './junit.js'

/**
 * One failure, addressable and diagnosable.
 *
 * Identity (`file`, `line`, `suite`, `name`) comes from JUnit, which knows where a test
 * is declared; `detail` points into the console log, which is the only place Bun writes
 * what actually went wrong — its JUnit `<failure>` element is self-closing and empty.
 */
export interface JoinedFailure {
  /** 1-based, assigned across the whole run so `test:show #3` is unambiguous. */
  id: number
  file: string
  line: number | null
  /** Describe chain, outermost → innermost. */
  suite: string[]
  name: string
  ms: number
  /** Byte range into the run's log, or `null` when the two sides could not be paired. */
  detail: { logOffset: number; logLength: number } | null
}

export interface JoinResult {
  failures: JoinedFailure[]
  joinWarnings: string[]
}

const SEPARATOR = ' > '

/** The console prints `describe > describe > test`; JUnit stores the parts separately. */
const markerFor = (testCase: Pick<JUnitCase, 'suitePath' | 'name'>): string =>
  [...testCase.suitePath, testCase.name].join(SEPARATOR)

/** Split a console marker back into a describe chain plus a leaf name. */
const splitMarker = (markerText: string): { suite: string[]; name: string } => {
  const parts = markerText.split(SEPARATOR)
  const name = parts.pop() ?? markerText
  return { suite: parts, name }
}

const rangeOf = (block: LogFailureBlock): { logOffset: number; logLength: number } => ({
  logOffset: block.offset,
  logLength: block.length,
})

/**
 * Collect the log's failure blocks per file, preserving the order Bun printed them.
 *
 * Segments are keyed rather than indexed because a file's output is not guaranteed to
 * arrive as one contiguous section, and because the caller may hand them over in any
 * order — grouping by file is what makes the positional pairing below safe under
 * `--parallel`, where global ordering is not.
 */
const blocksByFile = (segments: readonly LogSegment[]): Map<string, LogFailureBlock[]> => {
  const grouped = new Map<string, LogFailureBlock[]>()
  for (const segment of segments) {
    const file = segment.file
    // Output printed before any file header belongs to no test file. It is preamble
    // (the version banner) or a stray write, and has no identity to join against.
    if (file === null) continue
    const existing = grouped.get(file)
    if (existing === undefined) grouped.set(file, [...segment.blocks])
    else existing.push(...segment.blocks)
  }
  return grouped
}

interface PairContext {
  file: string
  failures: JoinedFailure[]
  warnings: string[]
  nextId: () => number
}

/**
 * Pair one file's JUnit failures against its console blocks, position by position.
 *
 * Within a single file, console order and JUnit order are the same — both follow
 * declaration order. Globally they are not, which is why this is scoped to a file.
 * Positional pairing is also the only thing that can tell `A > x` from `B > x`, since
 * the leaf names collide.
 */
const pairOne = (context: PairContext, testCase: JUnitCase, block: LogFailureBlock | undefined): void => {
  const expected = markerFor(testCase)
  // A mismatch means the two sides disagree about what ran. Keeping JUnit's identity and
  // dropping the range degrades to "we know it failed, look in the log yourself";
  // guessing a range would attach someone else's stack trace to this failure.
  const agrees = block !== undefined && block.markerText === expected
  if (block !== undefined && !agrees) {
    context.warnings.push(
      `${context.file}: console marker "${block.markerText}" does not match junit "${expected}"; ` +
        `diagnostic range dropped`,
    )
  }
  context.failures.push({
    id: context.nextId(),
    file: context.file,
    line: testCase.line,
    suite: [...testCase.suitePath],
    name: testCase.name,
    ms: testCase.ms,
    detail: agrees && block !== undefined ? rangeOf(block) : null,
  })
}

/**
 * Adopt console blocks JUnit never mentioned, taking identity from the marker text.
 *
 * Not a corner case: Bun omits files that fail to load, and writes no JUnit file at all
 * when every file does — so without this, the worst runs would report zero failures.
 */
const adoptOrphans = (context: PairContext, blocks: readonly LogFailureBlock[]): void => {
  for (const block of blocks) {
    const { suite, name } = splitMarker(block.markerText)
    context.failures.push({
      id: context.nextId(),
      file: context.file,
      line: null,
      suite,
      name,
      ms: block.ms,
      detail: rangeOf(block),
    })
  }
}

const pairWithin = (context: PairContext, cases: readonly JUnitCase[], blocks: readonly LogFailureBlock[]): void => {
  const paired = Math.min(cases.length, blocks.length)
  // A zero-case file is not a count mismatch — it is the log-only path, and the caller
  // has already said so in a more specific warning. Repeating it here would report the
  // same condition twice.
  if (cases.length > 0 && cases.length !== blocks.length) {
    context.warnings.push(
      `${context.file}: ${cases.length} junit failure(s) but ${blocks.length} console block(s); ` +
        `${paired} paired, the rest carry identity without a diagnostic`,
    )
  }

  for (const [index, testCase] of cases.entries()) {
    pairOne(context, testCase, index < paired ? blocks[index] : undefined)
  }
  adoptOrphans(context, blocks.slice(cases.length))
}

/**
 * Fold the JUnit index and the console log into one addressable failure list.
 *
 * Never throws and never guesses. Disagreement between the two sides is recorded in
 * `joinWarnings` and surfaced by `test:status`, so a Bun upgrade that changes either
 * format shows up as a visible complaint rather than as silently empty diagnostics.
 */
export function joinFailures(junit: JUnitRun, segments: readonly LogSegment[]): JoinResult {
  const grouped = blocksByFile(segments)
  const failures: JoinedFailure[] = []
  const warnings: string[] = []
  let id = 0
  const context = { failures, warnings, nextId: (): number => (id += 1) }

  for (const [file, cases] of junit.byFile) {
    const failing = cases.filter((testCase) => testCase.failed)
    const blocks = grouped.get(file) ?? []
    grouped.delete(file)
    if (failing.length === 0 && blocks.length === 0) continue
    if (failing.length === 0) {
      warnings.push(`${file}: ${blocks.length} console failure(s) absent from junit; identity taken from the log`)
    }
    pairWithin({ ...context, file }, failing, blocks)
  }

  // Files the log knows about and JUnit does not, in the order the log printed them.
  for (const [file, blocks] of grouped) {
    if (blocks.length === 0) continue
    warnings.push(`${file}: ${blocks.length} console failure(s) absent from junit; identity taken from the log`)
    pairWithin({ ...context, file }, [], blocks)
  }

  return { failures, joinWarnings: warnings }
}
