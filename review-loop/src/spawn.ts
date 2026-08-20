// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { spawn, type ChildProcess } from 'node:child_process'

import type { LineSink, SpawnFn, SpawnResult } from './agent-runner.js'

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

export const realSpawn: SpawnFn = (command, args, options, onLine): Promise<SpawnResult> => {
  return new Promise((resolve) => {
    const ctx: SpawnCtx = {
      child: spawn(command, [...args], {
        cwd: options.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      }),
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
