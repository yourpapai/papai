// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Answers questions about the last run from the artifact it left behind.
 *
 * Every renderer is pure — a {@link QueryContext} in, text out. Nothing here starts a
 * run: a second question about one run must never cost a second run, and the test suite
 * asserts that against this file's own source.
 */

import type { JoinedFailure } from './join.js'
import { LAST_RUN_JSON, LAST_RUN_LOG } from './paths.js'
import type { RunReport, RunScope } from './report.js'

export interface QueryContext {
  report: RunReport | null
  /** Byte-complete log of the run, or `null` when it was not captured. */
  log: string | null
  currentFingerprint: string
}

const NO_REPORT = `no usable report at ${LAST_RUN_JSON} — run \`bun run test\` first`
const NO_LOG = `no captured log for this run — ${LAST_RUN_LOG} is missing`

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`

const formatMs = (ms: number): string => {
  if (ms >= 10_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms >= 10) return `${String(Math.round(ms))}ms`
  return `${ms.toFixed(2)}ms`
}

const fullName = (failure: JoinedFailure): string => [...failure.suite, failure.name].join(' > ')

const location = (failure: JoinedFailure): string =>
  failure.line === null ? failure.file : `${failure.file}:${String(failure.line)}`

const failureLine = (failure: JoinedFailure, indent: string): string =>
  `${indent}#${String(failure.id)}  ${location(failure)}  ${fullName(failure)}  (${formatMs(failure.ms)})`

/**
 * `⚠ …` when the tree has moved on since the run, else `null`. A digest cannot say how
 * many files changed, so the banner reports what it knows: that something under the
 * fingerprint roots did, and both digests.
 */
export function stalenessBanner(ctx: QueryContext): string | null {
  const report = ctx.report
  if (report === null || report.fingerprint === ctx.currentFingerprint) return null
  return `⚠ source files changed since this run (fingerprint ${report.fingerprint} → ${ctx.currentFingerprint}) — re-run bun run test`
}

/** Flags an answer as possibly out of date; never withholds it. */
const withBanner = (ctx: QueryContext, body: string): string => {
  const banner = stalenessBanner(ctx)
  return banner === null ? body : `${banner}\n\n${body}`
}

const field = (label: string, value: string): string => `${label.padEnd(9)}  ${value}`

const scopeText = (scope: RunScope): string => {
  if (scope.kind === 'full') return 'full suite'
  const by = scope.selectedBy === undefined ? '' : ` (selected by ${scope.selectedBy})`
  return `${plural(scope.paths.length, 'path')}${by} — ${scope.paths.join(', ')}`
}

const resultText = (report: RunReport): string => {
  const totals = report.totals
  if (totals.fail === 0 && report.runErrors.length === 0) return `PASS — all ${plural(totals.tests, 'test')} passed`
  const failed = report.failures.map((failure) => failure.file)
  const broken = report.runErrors.flatMap((error) => (error.file === null ? [] : [error.file]))
  return `FAIL — ${plural(totals.fail, 'failing test')} in ${plural(new Set([...failed, ...broken]).size, 'file')}`
}

const freshnessText = (ctx: QueryContext, report: RunReport): string =>
  report.fingerprint === ctx.currentFingerprint
    ? `current (fingerprint ${report.fingerprint})`
    : `STALE — source files changed (fingerprint ${report.fingerprint} → ${ctx.currentFingerprint})`

const listSection = (heading: string, items: readonly string[]): string[] =>
  items.length === 0 ? [] : ['', `${heading} (${String(items.length)}):`, ...items.map((item) => `  - ${item}`)]

/** When the run was, what it covered, how it went, and whether it still describes the tree. */
export function renderStatus(ctx: QueryContext): string {
  const report = ctx.report
  if (report === null) return NO_REPORT

  const totals = report.totals
  const git = report.gitSha === null ? '' : `, git ${report.gitSha}`
  const counts = `${totals.pass} pass, ${totals.fail} fail, ${totals.skip} skip, ${totals.expects} expect() calls`
  const lines = [
    field('last run', `${report.startedAt} (${formatMs(report.wallMs)} wall, ${report.mode}${git})`),
    field('scope', scopeText(report.scope)),
    field('totals', `${plural(totals.tests, 'test')} across ${plural(totals.files, 'file')} — ${counts}`),
    field('result', resultText(report)),
    field('freshness', freshnessText(ctx, report)),
  ]
  if (totals.fail > 0 || report.runErrors.length > 0) lines.push(field('next', 'bun run test:failures'))

  // Join warnings are how a Bun output-format change surfaces; never swallow them.
  const errors = report.runErrors.map((error) => `${error.file ?? '(no file)'}: ${error.message.split('\n')[0] ?? ''}`)
  lines.push(...listSection('run errors', errors), ...listSection('join warnings', report.joinWarnings))
  return withBanner(ctx, lines.join('\n'))
}

const groupByFile = (failures: readonly JoinedFailure[]): Map<string, JoinedFailure[]> => {
  const grouped = new Map<string, JoinedFailure[]>()
  for (const failure of failures) grouped.set(failure.file, [...(grouped.get(failure.file) ?? []), failure])
  return grouped
}

const noFailuresText = (report: RunReport): string =>
  `no failing tests in the last run (${plural(report.totals.tests, 'test')} across ${plural(report.totals.files, 'file')})`

/** Every failing test, grouped by file so a whole file can be read or re-run at once. */
export function renderFailures(ctx: QueryContext, opts: { filesOnly: boolean }): string {
  const report = ctx.report
  if (report === null) return NO_REPORT
  if (report.failures.length === 0) return withBanner(ctx, noFailuresText(report))

  const grouped = groupByFile(report.failures)
  if (opts.filesOnly) return withBanner(ctx, [...grouped.keys()].join('\n'))

  const lines = [`${plural(report.failures.length, 'failing test')} in ${plural(grouped.size, 'file')}`]
  for (const [file, failures] of grouped) {
    lines.push('', `${file} (${String(failures.length)})`)
    for (const failure of failures) lines.push(failureLine(failure, '  '))
  }
  lines.push('', `next  bun run test:show '#${String(report.failures[0]?.id ?? 1)}'`)
  return withBanner(ctx, lines.join('\n'))
}

/**
 * `#id` → `file:line` → `file` → case-insensitive substring of `suite > name`. A form
 * falls through only when it selects nothing, so an id is never shadowed by a name.
 */
const selectFailures = (failures: readonly JoinedFailure[], selector: string): JoinedFailure[] => {
  // `#2` and `2` both mean id 2. The bare form is not a convenience: `#` starts a comment
  // in bash, so an unquoted `test:show #2` copied out of the run summary arrives here as
  // no selector at all. Accepting the digits alone makes the obvious thing work.
  const byId = /^#?(\d+)$/u.exec(selector)
  if (byId !== null) return failures.filter((failure) => failure.id === Number(byId[1]))

  const at = /^(.+):(\d+)$/u.exec(selector)
  const located = at === null ? [] : failures.filter((f) => f.file === at[1] && f.line === Number(at[2]))
  if (located.length > 0) return located

  const byFile = failures.filter((failure) => failure.file === selector)
  if (byFile.length > 0) return byFile

  const needle = selector.toLowerCase()
  return failures.filter((failure) => fullName(failure).toLowerCase().includes(needle))
}

const detailText = (ctx: QueryContext, failure: JoinedFailure): string => {
  const detail = failure.detail
  if (detail === null) return '  (no diagnostic could be paired with this failure — try bun run test:log)'
  const log = ctx.log
  if (log === null) return `  (${NO_LOG})`
  return log.slice(detail.logOffset, detail.logOffset + detail.logLength).replace(/\n+$/u, '')
}

/** A failing test's identity plus the diagnostic Bun printed for it. */
export function renderShow(ctx: QueryContext, selector: string): string {
  const report = ctx.report
  if (report === null) return NO_REPORT

  const matches = selectFailures(report.failures, selector)
  if (matches.length === 0) {
    const recorded = plural(report.failures.length, 'failure')
    return withBanner(ctx, `no failure matches "${selector}" — ${recorded} recorded; run bun run test:failures to list`)
  }

  // Every match, never a "which did you mean?": an agent pasting a name back is answered.
  const lines = matches.length === 1 ? [] : [`${plural(matches.length, 'failure')} match "${selector}"`, '']
  for (const failure of matches) lines.push(failureLine(failure, ''), detailText(ctx, failure), '')
  return withBanner(ctx, lines.join('\n').trimEnd())
}

/** Line indexes within `context` lines of a match, deduplicated and ordered. */
const expandContext = (matched: readonly number[], total: number, context: number): number[] => {
  const wanted = new Set<number>()
  for (const index of matched) {
    const last = Math.min(total - 1, index + context)
    for (let cursor = Math.max(0, index - context); cursor <= last; cursor += 1) wanted.add(cursor)
  }
  return [...wanted].sort((left, right) => left - right)
}

/** grep-style: `:` marks a matching line, `-` a context line, `--` a gap between groups. */
const renderHits = (lines: readonly string[], shown: readonly number[], matched: ReadonlySet<number>): string[] => {
  const width = String(lines.length).length
  const body: string[] = []
  let previous = -1
  for (const index of shown) {
    if (previous !== -1 && index > previous + 1) body.push('--')
    body.push(`${String(index + 1).padStart(width)}${matched.has(index) ? ':' : '-'} ${lines[index] ?? ''}`)
    previous = index
  }
  return body
}

/**
 * A regex over the persisted log — the honest replacement for re-running the suite to
 * apply a different grep. Always capped, so a broad pattern costs one screen, not a run.
 */
export function renderLog(ctx: QueryContext, pattern: string, opts: { context: number; max: number }): string {
  if (ctx.report === null) return NO_REPORT
  const log = ctx.log
  if (log === null) return withBanner(ctx, NO_LOG)

  let regex: RegExp
  try {
    regex = new RegExp(pattern, 'u')
  } catch {
    return withBanner(ctx, `"${pattern}" is not a usable regular expression`)
  }

  const lines = log.split('\n')
  const matched = lines.flatMap((line, index) => (regex.test(line) ? [index] : []))
  if (matched.length === 0) {
    return withBanner(ctx, `no lines match /${pattern}/ in ${LAST_RUN_LOG} (${plural(lines.length, 'line')})`)
  }

  const max = Math.max(1, opts.max)
  const wanted = expandContext(matched, lines.length, Math.max(0, opts.context))
  const shown = wanted.slice(0, max)
  const found = new Set(matched)
  const hidden = matched.length - shown.filter((index) => found.has(index)).length
  const scope = `(context ${String(opts.context)}, max ${String(max)} lines)`
  const head = `pattern /${pattern}/ — ${plural(matched.length, 'matching line')} in ${LAST_RUN_LOG} ${scope}`
  const cut =
    wanted.length > max ? [`… truncated at ${String(max)} lines (${plural(hidden, 'more matching line')})`] : []
  return withBanner(ctx, [head, '', ...renderHits(lines, shown, found), ...cut].join('\n'))
}

/** Where the run's time went, per file. */
export function renderSlowest(ctx: QueryContext, n: number): string {
  const report = ctx.report
  if (report === null) return NO_REPORT
  if (report.slowestFiles.length === 0) return withBanner(ctx, 'no per-file timings recorded in this run')

  const shown = report.slowestFiles.slice(0, Math.max(1, n))
  const total = String(report.slowestFiles.length)
  const head = `slowest ${plural(shown.length, 'file')} of ${total} recorded (in-test time, not wall)`
  const rows = shown.map((f) => `  ${formatMs(f.ms).padStart(9)}  ${f.file}  (${plural(f.tests, 'test')})`)
  return withBanner(ctx, [head, '', ...rows].join('\n'))
}
