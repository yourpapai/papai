// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn } from 'node:child_process'
import { mkdtemp, open, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { scrubCredentialValue } from './backend-select.js'
import { formatDuration } from './live-format.js'
import { withLivePhase } from './live-renderer.js'
import type { ProgressReporter } from './progress-log.js'

export type ShellExecFn = (cwd?: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>

export interface BuildCheckDeps {
  exec: ShellExecFn
  /**
   * The selected credential's value on the claude route, scrubbed once inside
   * `runBuildCheck` — the single producer of `BuildCheckResult` — so every
   * downstream embed (`build-check.log`, needs-human reasoning, the retry
   * `buildError` prompt, the thrown build error's tail) reads one scrubbed
   * copy. Absent on the opencode route.
   */
  credentialValue?: string
}

export interface BuildCheckResult {
  passed: boolean
  stdout: string
  stderr: string
}

interface RawExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

interface ExecOptions {
  cwd: string
  timeout?: number
}

/**
 * Runs `sh -c command` with the child's stdout and stderr pointed at regular
 * files rather than pipes, then reads them back.
 *
 * Pipes are what broke run 33974052563. The check command is `bun check:full`,
 * and `check.sh` reports a failing check by `cat`-ing that check's whole log to
 * stdout. When stdout is the parent's captured pipe, the fd carries O_NONBLOCK
 * — it is a property of the shared open file description, not of our end — so a
 * `cat` that outruns the parent's reader gets EAGAIN, prints
 * `cat: write error: Resource temporarily unavailable`, and exits 1. Under
 * `set -euo pipefail` that aborts `check.sh` before it prints the one line that
 * names which check failed, and the exit code the loop reports is `cat`'s, not
 * the check's. The same bug is already documented against the `Checks` CI job
 * (`.github/workflows/ci.yml`, run 33153391880).
 *
 * A regular file has no such failure mode: writes to it never return EAGAIN, so
 * the report always completes. It also retires the `maxBuffer` ceiling — the
 * former 10 MB cap silently truncated a big run — since nothing is buffered in
 * this process until the child has exited.
 */
async function runExec(file: string, args: string[], options: ExecOptions): Promise<RawExecResult> {
  const dir = await mkdtemp(path.join(tmpdir(), 'review-loop-check-'))
  const outPath = path.join(dir, 'stdout.log')
  const errPath = path.join(dir, 'stderr.log')
  const outHandle = await open(outPath, 'w')
  const errHandle = await open(errPath, 'w')
  try {
    const { code, timedOut } = await new Promise<{ code: number; timedOut: boolean }>((resolve) => {
      const child = spawn(file, args, { cwd: options.cwd, stdio: ['ignore', outHandle.fd, errHandle.fd] })
      let killed = false
      const timer =
        options.timeout !== undefined && options.timeout > 0
          ? setTimeout(() => {
              killed = true
              child.kill('SIGKILL')
            }, options.timeout)
          : undefined
      const settle = (exitCode: number): void => {
        if (timer !== undefined) clearTimeout(timer)
        resolve({ code: exitCode, timedOut: killed })
      }
      child.on('error', () => {
        settle(1)
      })
      child.on('close', (exitCode) => {
        settle(exitCode ?? 1)
      })
    })
    const stdout = await readFile(outPath, 'utf8')
    const stderr = await readFile(errPath, 'utf8')
    if (timedOut) {
      return { exitCode: 1, stdout, stderr: `${stderr}Process timed out after ${String(options.timeout)}ms\n` }
    }
    return { exitCode: code, stdout, stderr }
  } finally {
    await outHandle.close()
    await errHandle.close()
    await rm(dir, { recursive: true, force: true })
  }
}

export async function runBuildCheck(deps: BuildCheckDeps): Promise<BuildCheckResult> {
  const result = await deps.exec()
  const value = deps.credentialValue ?? null
  return {
    passed: result.exitCode === 0,
    stdout: scrubCredentialValue(result.stdout, value),
    stderr: scrubCredentialValue(result.stderr, value),
  }
}

export function createShellExec(cwd: string, command: string, timeoutMs?: number): ShellExecFn {
  return (overrideCwd?: string): Promise<RawExecResult> =>
    runExec('sh', ['-c', command], { cwd: overrideCwd ?? cwd, timeout: timeoutMs })
}

export async function runBuildWithLogging(
  exec: ShellExecFn,
  reporter: ProgressReporter,
  cwd?: string,
  opts?: { credentialValue?: string },
): Promise<BuildCheckResult> {
  const phase = await withLivePhase(reporter, 'build', () =>
    runBuildCheck({ exec: () => exec(cwd), credentialValue: opts?.credentialValue }),
  )
  reporter.event(`[build] ${phase.result.passed ? 'passed' : 'FAILED'} · ${formatDuration(phase.durationMs)}`)
  return phase.result
}

export function runAggregatedBuild(
  exec: ShellExecFn,
  reporter: ProgressReporter,
  cwd?: string,
  opts?: { credentialValue?: string },
): Promise<BuildCheckResult> {
  // Aggregated verification: one build over the working-tree diff after all batches.
  // For now, a single invocation of the same build command; attribution is handled
  // by the caller via diff --name-only vs spans.
  return runBuildWithLogging(exec, reporter, cwd, opts)
}
