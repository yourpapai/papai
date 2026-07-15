// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { execFile } from 'node:child_process'

export type ShellExecFn = () => Promise<{ exitCode: number; stdout: string; stderr: string }>

export interface BuildCheckDeps {
  exec: ShellExecFn
  cwd: string
  command: string
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

function runExec(file: string, args: string[], options: { cwd: string; maxBuffer: number }): Promise<RawExecResult> {
  return new Promise((resolve) => {
    execFile(file, args, options, (err, stdout, stderr) => {
      const exitCode = err === null ? 0 : typeof err.code === 'number' ? err.code : 1
      resolve({ exitCode, stdout, stderr })
    })
  })
}

export async function runBuildCheck(deps: BuildCheckDeps): Promise<BuildCheckResult> {
  const result = await deps.exec()
  return {
    passed: result.exitCode === 0,
    stdout: result.stdout,
    stderr: result.stderr,
  }
}

export function createShellExec(cwd: string, command: string): ShellExecFn {
  return (): Promise<RawExecResult> => runExec('sh', ['-c', command], { cwd, maxBuffer: 10 * 1024 * 1024 })
}
