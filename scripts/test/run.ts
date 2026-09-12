// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { CHILD_TIMEOUT_DEMOTE_MS, CHILD_TIMEOUT_MS, parseWrapperArgs, selectMode } from './mode.js'
import type { ExecutionMode } from './mode.js'
import { LAST_RUN_JUNIT, LAST_RUN_LOG, REPORT_DIR } from './paths.js'
import { buildReport } from './report.js'
import type { RunReport, RunScope } from './report.js'

/** How many failures the summary names before it defers to `bun run test:failures`. */
const MAX_LISTED_FAILURES = 5

/** How many load errors the summary names before it defers to the log. */
const MAX_LISTED_RUN_ERRORS = 3

/** Load-error messages carry a full module path; enough of one to recognise it is plenty. */
const MAX_MESSAGE_CHARS = 120

/** The one line every run ends with, green or not. */
const ARTIFACT_LINE = `${REPORT_DIR}/last-run.{log,junit.xml,json}`

/** One child run: its code, its byte-complete combined output, its wall time. */
export interface SpawnResult {
  exitCode: number
  output: string
  wallMs: number
}

/**
 * Every side effect the wrapper performs. `runWrapper` touches nothing else — no
 * filesystem, no process, no clock — so the order of operations is assertable.
 */
export interface RunDeps {
  /** Repo root; only used to normalise the paths Bun prints. */
  cwd: string
  /** Environment consulted by `selectMode` (`CI`). */
  env: Record<string, string | undefined>
  /** Core count consulted by `selectMode`. */
  cores: number
  /** 1-minute load average consulted by `selectMode` for load demotion. */
  load1: number
  /** Whether stdout is a terminal; a non-TTY defaults the run to streaming. */
  stdoutIsTTY: boolean
  /** Build the client bundles if they are missing, before anything else runs. */
  ensureClientBuilt: () => void
  /** Drop the previous run's log and junit so a run that writes neither cannot inherit them. */
  clearArtifacts: () => void
  spawn: (argv: readonly string[], options: { stream: boolean }) => Promise<SpawnResult>
  fingerprint: () => string
  gitSha: () => string | null
  /** `null` when Bun wrote no junit file — which is what happens when every file fails to load. */
  readJUnit: () => string | null
  writeArtifacts: (log: string, junitXml: string | null, report: RunReport) => void
  print: (line: string) => void
  /** ISO timestamp for `startedAt`. */
  now: () => string
}

const pluralize = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`

/** `27.6s` below a minute, `6m01s` above it — the shape a wall time is actually read in. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes)}m${String(seconds).padStart(2, '0')}s`
}

const countsLine = (report: RunReport): string => {
  const totals = report.totals
  return [
    pluralize(totals.files, 'file'),
    pluralize(totals.tests, 'test'),
    `${String(totals.pass)} pass`,
    `${String(totals.fail)} fail`,
    `${String(totals.skip)} skip`,
    `${formatDuration(report.wallMs)} (${report.mode}${report.loadDemoted ? ' · load' : ''})`,
  ].join(' · ')
}

const locationOf = (failure: RunReport['failures'][number]): string =>
  failure.line === null ? failure.file : `${failure.file}:${String(failure.line)}`

const titleOf = (failure: RunReport['failures'][number]): string =>
  [...failure.suite, failure.name === '' ? '(unnamed)' : failure.name].join(' > ')

const morePointer = (remaining: number, pointer: string): string[] =>
  remaining > 0 ? [`  … ${String(remaining)} more — ${pointer}`] : []

/** A header naming the query that expands it, then one addressable line per failure. */
const failureLines = (failures: RunReport['failures']): string[] => {
  if (failures.length === 0) return []
  const shown = failures.slice(0, MAX_LISTED_FAILURES)
  const width = Math.max(...shown.map((failure) => locationOf(failure).length))
  const listed = shown.map(
    (failure) => `  #${String(failure.id)}  ${locationOf(failure).padEnd(width)}  ${titleOf(failure)}`,
  )
  return [
    // `<id>` not `<#id>`: bash eats an unquoted `#`, dropping the pasted argument.
    `${pluralize(failures.length, 'failure')} — bun run test:show <id>`,
    ...listed,
    ...morePointer(failures.length - shown.length, 'bun run test:failures'),
  ]
}

const truncate = (text: string): string =>
  text.length <= MAX_MESSAGE_CHARS ? text : `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…`

/**
 * Files that never produced a testcase. On a checkout with missing dependencies this is
 * the *only* evidence a run happened, so it gets its own block.
 */
const runErrorLines = (runErrors: RunReport['runErrors']): string[] => {
  if (runErrors.length === 0) return []
  const shown = runErrors.slice(0, MAX_LISTED_RUN_ERRORS)
  const listed = shown.map((error) => `  ${error.file ?? '(unknown file)'} — ${truncate(error.message)}`)
  return [
    `${pluralize(runErrors.length, 'module error')} — no tests ran in these files`,
    ...listed,
    ...morePointer(runErrors.length - shown.length, LAST_RUN_LOG),
  ]
}

/**
 * The whole terminal output of a run: at most 14 lines, exactly 2 when nothing went
 * wrong. Everything it omits is on disk and reachable by a query command.
 */
export function formatSummary(report: RunReport): string[] {
  return [countsLine(report), ...failureLines(report.failures), ...runErrorLines(report.runErrors), ARTIFACT_LINE]
}

/**
 * The child's flags, without the `bun test` prefix — this is also what lands in the
 * report's `argv`, so a later reader can see exactly what the run was.
 */
const childFlagsFor = (
  mode: ExecutionMode,
  loadDemoted: boolean,
  passthrough: readonly string[],
  persist: boolean,
): string[] => [
  ...(mode === 'parallel' ? ['--parallel'] : []),
  '--timeout',
  // Injected before the passthrough args, so an explicit `--timeout` still wins.
  loadDemoted ? CHILD_TIMEOUT_DEMOTE_MS : CHILD_TIMEOUT_MS,
  ...(persist ? ['--reporter=junit', `--reporter-outfile=${LAST_RUN_JUNIT}`] : []),
  ...passthrough,
]

const scopeFor = (paths: readonly string[]): RunScope =>
  paths.length > 0 ? { kind: 'paths', paths: [...paths] } : { kind: 'full' }

/**
 * Run the suite and leave a queryable artifact behind. Returns the child's exit code
 * unchanged — the wrapper reports, it never re-judges.
 *
 * Async because the real spawn streams the child's log live while it runs; the
 * async surface stops here and at `main` (see design.md).
 */
export async function runWrapper(argv: readonly string[], deps: RunDeps): Promise<number> {
  deps.ensureClientBuilt()

  const args = parseWrapperArgs(argv)
  const plan = selectMode(args.mode, deps.env, deps.cores, deps.load1)
  const flags = childFlagsFor(plan.mode, plan.loadDemoted, args.passthrough, !args.bypass)
  // A piped run has no summary to watch; stream it instead. Bypass runs keep the
  // terminal themselves and are exempt from the default.
  const stream = args.bypass ? args.stream : args.stream || !deps.stdoutIsTTY

  // `--watch` / `--update-snapshots` are interactive; there is no meaningful "last run".
  if (args.bypass) return (await deps.spawn(['bun', 'test', ...flags], { stream: args.stream })).exitCode

  deps.clearArtifacts()
  const startedAt = deps.now()
  const child = await deps.spawn(['bun', 'test', ...flags], { stream })
  const junitXml = deps.readJUnit()

  const report = buildReport({
    junitXml,
    logText: child.output,
    cwd: deps.cwd,
    startedAt,
    wallMs: child.wallMs,
    argv: flags,
    scope: scopeFor(args.paths),
    mode: plan.mode,
    loadDemoted: plan.loadDemoted,
    fingerprint: deps.fingerprint(),
    gitSha: deps.gitSha(),
  })

  deps.writeArtifacts(child.output, junitXml, report)
  for (const line of formatSummary(report)) deps.print(line)

  return child.exitCode
}
