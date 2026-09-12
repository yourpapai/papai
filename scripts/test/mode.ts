// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type ExecutionMode = 'parallel' | 'serial'

/**
 * The per-test timeout every wrapper-driven run gets. Passed before the caller's
 * passthrough args so an explicit `--timeout` on the command line still wins.
 * Lives here next to the demotion logic that picks between the two.
 */
export const CHILD_TIMEOUT_MS = '15000'

/** The timeout a load-demoted serial run gets instead: slower host, more headroom. */
export const CHILD_TIMEOUT_DEMOTE_MS = '30000'

/** A 1-minute load at or above this fraction of the cores demotes a parallel-capable host. */
const LOAD_DEMOTION_RATIO = 0.75

export interface ExecutionPlan {
  mode: ExecutionMode
  /** True only when the load branch demoted a parallel-capable host to serial. */
  loadDemoted: boolean
}

export interface WrapperArgs {
  /** Explicit `--serial` / `--parallel` override, else `null`. */
  mode: ExecutionMode | null
  /** `--watch` / `-u` / `--update-snapshots`: stream through, skip persistence. */
  bypass: boolean
  /** `--stream`: mirror the child's output live. */
  stream: boolean
  /** Everything for the child, minus the wrapper-only flags. */
  passthrough: string[]
  /** Positional (non-flag) arguments; these also remain in `passthrough`. */
  paths: string[]
}

/** Flags consumed by the wrapper itself and never forwarded to the child. */
const WRAPPER_ONLY_FLAGS = new Set(['--serial', '--parallel', '--stream'])

/** Flags that make the run interactive/authoritative, so persistence is skipped. */
const BYPASS_FLAGS = new Set(['--watch', '-u', '--update-snapshots'])

/**
 * Flags Bun accepts in separated form (`--timeout 30000`). The token after one of
 * these is the flag's value, not a positional path. The inline form (`--timeout=30000`)
 * carries its value already and never matches this set.
 */
const VALUE_TAKING_FLAGS = new Set([
  '-t',
  '--test-name-pattern',
  '--timeout',
  '--bail',
  '--rerun-each',
  '--retry',
  '--seed',
  '--max-concurrency',
  '--reporter',
  '--reporter-outfile',
  '--coverage-reporter',
  '--coverage-dir',
  '--path-ignore-patterns',
  '--config',
])

/**
 * Split a wrapper argv into wrapper-level decisions and the child's argv.
 *
 * Pure: no filesystem, no process, no environment access.
 */
export function parseWrapperArgs(argv: readonly string[]): WrapperArgs {
  let mode: ExecutionMode | null = null
  let bypass = false
  let stream = false
  const passthrough: string[] = []
  const paths: string[] = []
  let expectsValue = false

  for (const arg of argv) {
    if (WRAPPER_ONLY_FLAGS.has(arg)) {
      if (arg === '--serial') mode = 'serial'
      else if (arg === '--parallel') mode = 'parallel'
      else stream = true
      continue
    }

    if (BYPASS_FLAGS.has(arg)) bypass = true
    passthrough.push(arg)

    if (arg.startsWith('-')) {
      expectsValue = VALUE_TAKING_FLAGS.has(arg)
    } else if (expectsValue) {
      expectsValue = false
    } else {
      paths.push(arg)
    }
  }

  return { mode, bypass, stream, passthrough, paths }
}

/**
 * Resolve the execution plan, in order: explicit override wins; a truthy `CI`
 * means `serial`; a many-core host (>= 8 cores) whose 1-minute load has reached
 * `LOAD_DEMOTION_RATIO x cores` is demoted to `serial` (and marked as such);
 * a machine with at least 8 cores means `parallel`; else `serial`.
 *
 * Only the load branch sets `loadDemoted`: explicit serial, CI serial, and
 * few-core serial are all choices, not demotions. Platforms without loadavg
 * report 0, which never meets the threshold.
 *
 * Pure: `env`, `cores` and `load1` are parameters, nothing is read from the host.
 */
export function selectMode(
  explicit: ExecutionMode | null,
  env: Record<string, string | undefined>,
  cores: number,
  load1: number,
): ExecutionPlan {
  if (explicit !== null) return { mode: explicit, loadDemoted: false }

  const ci = env['CI']
  if (ci !== undefined && ci !== '' && ci !== 'false') return { mode: 'serial', loadDemoted: false }

  if (cores >= 8) {
    if (load1 >= LOAD_DEMOTION_RATIO * cores) return { mode: 'serial', loadDemoted: true }
    return { mode: 'parallel', loadDemoted: false }
  }

  return { mode: 'serial', loadDemoted: false }
}
