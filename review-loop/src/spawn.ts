// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn, type ChildProcess } from 'node:child_process'

export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
  // True when the kill was triggered by the inactivity watchdog (no stdout for
  // inactivityTimeoutMs) rather than the wall-clock timeout. Stalls are
  // retryable: a hung provider stream is transient, unlike an over-budget run.
  stalled?: boolean
}

export type LineSink = (line: string) => void

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: {
    cwd: string
    timeout?: number
    killGraceMs?: number
    inactivityTimeoutMs?: number
    /** Written to the child's stdin, then half-closed — the claude prompt's carrier. */
    stdin?: string
    /** The child's entire replacement environment; absent inherits `process.env`. */
    env?: Record<string, string>
  },
  onLine?: LineSink,
) => Promise<SpawnResult>

export function splitLines(pending: string, chunk: string): { lines: string[]; remaining: string } {
  const parts = (pending + chunk).split('\n')
  const remaining = parts.pop() ?? ''
  const lines = parts.filter((line) => line.length > 0)
  return { lines, remaining }
}

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return
  try {
    process.kill(-child.pid, signal)
  } catch {
    child.kill(signal)
  }
}

interface SpawnCtx {
  readonly child: ChildProcess
  stdout: string
  stderr: string
  pending: string
  timedOut: boolean
  stalled: boolean
  timer: ReturnType<typeof setTimeout> | null
  killTimer: ReturnType<typeof setTimeout> | null
  inactivityTimer: ReturnType<typeof setTimeout> | null
  readonly onLine?: LineSink
}

function terminate(ctx: SpawnCtx, graceMs: number): void {
  killGroup(ctx.child, 'SIGTERM')
  ctx.killTimer = setTimeout(() => {
    killGroup(ctx.child, 'SIGKILL')
  }, graceMs)
}

function setupKillTimers(ctx: SpawnCtx, options: { timeout?: number; killGraceMs?: number }): void {
  if (options.timeout === undefined || options.timeout <= 0) return
  ctx.timer = setTimeout(() => {
    ctx.timedOut = true
    terminate(ctx, options.killGraceMs ?? 5000)
  }, options.timeout)
}

// Inactivity watchdog: an agent whose LLM stream hangs produces no stdout at
// all, and would otherwise burn the entire wall-clock timeout doing nothing.
// The timer resets on every stdout chunk, so long-but-active steps (slow
// generations, long tool runs that stream) are never killed. A quiet child is
// SIGTERMed, then SIGKILLed after the same grace the wall-clock timeout uses.
function resetInactivityTimer(ctx: SpawnCtx, options: { inactivityTimeoutMs?: number; killGraceMs?: number }): void {
  const window = options.inactivityTimeoutMs
  if (window === undefined || window <= 0) return
  if (ctx.inactivityTimer !== null) clearTimeout(ctx.inactivityTimer)
  ctx.inactivityTimer = setTimeout(() => {
    ctx.timedOut = true
    ctx.stalled = true
    terminate(ctx, options.killGraceMs ?? 5000)
  }, window)
}

function clearKillTimers(ctx: SpawnCtx): void {
  if (ctx.timer !== null) clearTimeout(ctx.timer)
  if (ctx.killTimer !== null) clearTimeout(ctx.killTimer)
  if (ctx.inactivityTimer !== null) clearTimeout(ctx.inactivityTimer)
}

function timeoutResult(ctx: SpawnCtx, options: { timeout?: number; inactivityTimeoutMs?: number }): SpawnResult {
  const note = ctx.stalled
    ? `Process stalled: no output for ${options.inactivityTimeoutMs ?? 0}ms\n`
    : `Process timed out after ${options.timeout}ms\n`
  return { exitCode: 1, stdout: ctx.stdout, stderr: `${ctx.stderr}${note}`, timedOut: true, stalled: ctx.stalled }
}

/**
 * Starts the child process and delivers the optional stdin payload.
 *
 * Split from `realSpawn` when the stdin/env seams pushed it past
 * `max-lines-per-function`; the seam it draws is the spawn's own two halves —
 * starting the process versus watching it. Absent env inherits `process.env`
 * (the pre-seam behavior); a passed map is the child's **entire** environment,
 * because Node's `env` option replaces, never overlays. The stdin write is
 * half-closed after the write (the CLI reads the prompt until EOF), behind an
 * error-swallowing handler attached **before** the first write: a write beyond
 * the OS pipe buffer queues in the stream, and a child that exits early or is
 * group-killed by a watchdog mid-flush turns that queued write into an EPIPE —
 * a stream error with no listener would kill the whole loop process. The
 * failure reaches the caller through the exit/`AttemptError` path instead.
 */
function startChild(
  command: string,
  args: readonly string[],
  options: { cwd: string; stdin?: string; env?: Record<string, string> },
): ChildProcess {
  const child = spawn(command, [...args], {
    cwd: options.cwd,
    stdio: [options.stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    detached: true,
    ...(options.env === undefined ? {} : { env: options.env }),
  })
  if (options.stdin !== undefined && child.stdin !== null) {
    child.stdin.on('error', () => undefined)
    child.stdin.write(options.stdin)
    child.stdin.end()
  }
  return child
}

export const realSpawn: SpawnFn = (command, args, options, onLine): Promise<SpawnResult> => {
  return new Promise((resolve) => {
    const ctx: SpawnCtx = {
      child: startChild(command, args, options),
      stdout: '',
      stderr: '',
      pending: '',
      timedOut: false,
      stalled: false,
      timer: null,
      killTimer: null,
      inactivityTimer: null,
      onLine,
    }
    setupKillTimers(ctx, options)
    resetInactivityTimer(ctx, options)
    ctx.child.stdout?.on('data', (chunk: Buffer) => {
      ctx.stdout += chunk.toString()
      resetInactivityTimer(ctx, options)
      const split = splitLines(ctx.pending, chunk.toString())
      ctx.pending = split.remaining
      for (const line of split.lines) {
        ctx.onLine?.(line)
      }
    })
    ctx.child.stderr?.on('data', (chunk: Buffer) => {
      ctx.stderr += chunk.toString()
    })
    ctx.child.on('error', (err: Error) => {
      clearKillTimers(ctx)
      resolve({ exitCode: 1, stdout: ctx.stdout, stderr: ctx.stderr + err.message, timedOut: false })
    })
    ctx.child.on('close', (code, signal) => {
      clearKillTimers(ctx)
      if (ctx.pending.length > 0) {
        ctx.onLine?.(ctx.pending)
      }
      if (ctx.timedOut) {
        resolve(timeoutResult(ctx, options))
        return
      }
      resolve({ exitCode: code ?? (signal === null ? 0 : 1), stdout: ctx.stdout, stderr: ctx.stderr, timedOut: false })
    })
  })
}
