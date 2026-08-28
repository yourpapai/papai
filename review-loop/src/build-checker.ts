// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFile } from 'node:child_process'

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
  maxBuffer: number
  timeout?: number
}

function runExec(file: string, args: string[], options: ExecOptions): Promise<RawExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      let exitCode: number
      let resolvedStderr = stderr
      if (err === null) {
        exitCode = 0
      } else if (typeof err.code === 'number') {
        exitCode = err.code
      } else if (err.killed === true && options.timeout !== undefined && options.timeout > 0) {
        exitCode = 1
        resolvedStderr = `${stderr}Process timed out after ${options.timeout}ms\n`
      } else {
        exitCode = 1
      }
      resolve({ exitCode, stdout, stderr: resolvedStderr })
    })
  })
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
    runExec('sh', ['-c', command], { cwd: overrideCwd ?? cwd, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs })
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
