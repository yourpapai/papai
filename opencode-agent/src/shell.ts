// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

/** Result of one command invocation. Never throws on a non-zero exit. */
export interface CommandResult {
  command: string
  exitCode: number
  stdout: string
  stderr: string
  /**
   * Whether this run was killed by its own `timeoutMs` rather than exiting.
   *
   * A killed child arrives here as `exitCode: 1` with whatever it had written so
   * far, which is indistinguishable from a command that failed on its merits —
   * and the two earn completely different sentences on an issue. Optional
   * because almost every producer of this shape is a stub in a test that cannot
   * time out; absent means "not known to have timed out", never "did not".
   */
  timedOut?: boolean
}

/** Which of a child's two streams a line arrived on. */
export type OutputStream = 'stdout' | 'stderr'

export interface RunOptions {
  cwd: string
  env?: Record<string, string>
  timeoutMs?: number
  /**
   * What the deadline kills with. `SIGTERM` by default, as Node's own does.
   *
   * `SIGKILL` is for a child that **handles** `SIGTERM`, which the review loop
   * does: it reads one as "finish the fix in hand and stop", correct for a
   * Ctrl-C and wrong for the deadline sitting behind its own soft stop — the
   * loop has already been told to stop, and a graceful handler here buys one
   * more fixer subprocess with the runner's last minutes.
   */
  killSignal?: NodeJS.Signals
  /**
   * Called with each complete line the child writes, as it writes it.
   *
   * The buffered `CommandResult` is still assembled — this is an addition, not a
   * replacement. It exists because a subprocess that runs for an hour and is
   * only read from after it exits is, in a CI log, indistinguishable from a hang:
   * run 31704544065 spent 60 minutes inside the review loop and printed not one
   * line before the runner was taken away, and the buffered output died with it.
   */
  onOutput?: (line: string, stream: OutputStream) => void
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

/**
 * Splits a stream into whole lines across chunk boundaries.
 *
 * A chunk is whatever the pipe happened to deliver, so a line routinely arrives
 * in two of them and two lines routinely arrive in one. `flush` is what a child
 * that ends without a final newline earns — dropping that last line is how a
 * one-line error message becomes silence.
 */
const lineSplitter = (emit: (line: string) => void): { push: (chunk: string) => void; flush: () => void } => {
  let pending = ''

  return {
    push: (chunk): void => {
      const lines = `${pending}${chunk}`.split('\n')
      pending = lines.pop() ?? ''
      for (const line of lines) emit(line.replace(/\r$/u, ''))
    },
    flush: (): void => {
      if (pending.length === 0) return
      const line = pending
      pending = ''
      emit(line)
    },
  }
}

interface Capture {
  stdout: () => string
  stderr: () => string
  /** Emits whatever the child left without a closing newline. */
  flush: () => void
}

/**
 * Buffers both of a child's streams, mirroring each whole line to `onOutput`.
 *
 * Both, not one or the other: the buffered form is what every caller has always
 * read and the mirror is what makes a long run legible while it runs.
 */
const capture = (child: ChildProcessWithoutNullStreams, onOutput: RunOptions['onOutput']): Capture => {
  let stdout = ''
  let stderr = ''
  // `null` when the caller wants no stream, so the split work is not done at all
  // for the runs — every check, every git invocation — that only read the buffer.
  const split = (stream: OutputStream): ReturnType<typeof lineSplitter> | null =>
    onOutput === undefined
      ? null
      : lineSplitter((line): void => {
          onOutput(line, stream)
        })
  const outLines = split('stdout')
  const errLines = split('stderr')

  child.stdout.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stdout += text
    outLines?.push(text)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderr += text
    errLines?.push(text)
  })

  return {
    stdout: () => stdout,
    stderr: () => stderr,
    flush: (): void => {
      outLines?.flush()
      errLines?.flush()
    },
  }
}

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
      killSignal: options.killSignal,
      shell: false,
    })

    const output = capture(child, options.onOutput)

    child.on('error', (error: Error) => {
      output.flush()
      const stderr = `${output.stderr()}${error.message}`
      resolve({ command: argv.join(' '), exitCode: 127, stdout: output.stdout(), stderr, timedOut: false })
    })
    child.on('close', (code, signal) => {
      output.flush()
      // Node reports the deadline it enforced as a signal kill, and `killed` is
      // set for any kill — including one this process never asked for — so the
      // signal is read alongside it rather than instead of it.
      const timedOut = child.killed && signal !== null && code === null
      const result = { exitCode: code ?? 1, stdout: output.stdout(), stderr: output.stderr(), timedOut }
      resolve({ command: argv.join(' '), ...result })
    })
  })
