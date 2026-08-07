// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn } from 'node:child_process'

/** Result of one command invocation. Never throws on a non-zero exit. */
export interface CommandResult {
  command: string
  exitCode: number
  stdout: string
  stderr: string
}

export interface RunOptions {
  cwd: string
  env?: Record<string, string>
  timeoutMs?: number
}

/**
 * Runs an argv vector without a shell.
 *
 * No shell means no word splitting and no interpolation of issue-supplied text
 * into a command line — the pipeline feeds untrusted issue bodies to the model,
 * and this is the boundary that keeps that text out of `/bin/sh`.
 */
export type CommandRunner = (argv: readonly string[], options: RunOptions) => Promise<CommandResult>

const DEFAULT_TIMEOUT_MS = 15 * 60 * 1000

export const runCommand: CommandRunner = (argv, options) =>
  new Promise((resolve, reject) => {
    const [bin, ...args] = argv
    if (bin === undefined) {
      reject(new Error('runCommand requires a non-empty argv'))
      return
    }

    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env === undefined ? process.env : { ...process.env, ...options.env },
      timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error: Error) => {
      resolve({ command: argv.join(' '), exitCode: 127, stdout, stderr: `${stderr}${error.message}` })
    })
    child.on('close', (code) => {
      resolve({ command: argv.join(' '), exitCode: code ?? 1, stdout, stderr })
    })
  })
