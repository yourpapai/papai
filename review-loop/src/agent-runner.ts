// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile, copyFile, mkdir, readFile, unlink } from 'node:fs/promises'
import path from 'node:path'

import type { z } from 'zod'

import { type OpencodeEvent, parseEventLine } from './event-stream.js'
import { formatLiveLine, formatStepFooter, formatToolArg } from './live-renderer.js'
import type { ProgressReporter } from './progress-log.js'

export interface SpawnResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
}

export type LineSink = (line: string) => void

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { cwd: string; timeout?: number; killGraceMs?: number },
  onLine?: LineSink,
) => Promise<SpawnResult>

export interface RunAgentOptions<T> {
  spawn: SpawnFn
  model: string
  cwd: string
  prompt: string
  outputPath: string
  outputSchema: z.ZodType<T>
  label: string
  logPath: string
  extraArgs: readonly string[]
  reporter?: ProgressReporter
  onRetry?: () => void
  timeoutMs?: number
}

interface AttemptResult<T> {
  ok: true
  value: T
}

interface AttemptError {
  ok: false
  error: Error
  timedOut: boolean
}

type Attempt<T> = AttemptResult<T> | AttemptError

export interface LineHandler {
  onLine: LineSink
  dispose: () => void
}

interface LiveCtx {
  readonly label: string
  readonly logPath: string
  readonly reporter: ProgressReporter | undefined
  startedAt: number
  toolCount: number
  tool: string
  arg: string
  readonly seenCalls: Set<string>
  timer: ReturnType<typeof setInterval> | null
}

function renderLive(ctx: LiveCtx): void {
  const reporter = ctx.reporter
  if (reporter === undefined) {
    return
  }
  const elapsed = ctx.startedAt === 0 ? 0 : Date.now() - ctx.startedAt
  reporter.live(formatLiveLine(ctx.label, ctx.tool, ctx.arg, elapsed, ctx.toolCount))
}

function applyEvent(evt: OpencodeEvent, ctx: LiveCtx): void {
  const reporter = ctx.reporter
  if (reporter === undefined) {
    return
  }
  switch (evt.type) {
    case 'step_start':
      if (ctx.startedAt === 0) {
        ctx.startedAt = Date.now()
        if (reporter.dynamic) {
          ctx.timer = setInterval(() => {
            renderLive(ctx)
          }, 1000)
        }
      }
      break
    case 'tool_use':
      if (!ctx.seenCalls.has(evt.callId)) {
        ctx.seenCalls.add(evt.callId)
        ctx.toolCount += 1
      }
      ctx.tool = evt.tool
      ctx.arg = formatToolArg(evt.tool, evt.input)
      renderLive(ctx)
      break
    case 'step_finish':
      reporter.clearLive()
      reporter.event(
        formatStepFooter(ctx.label, ctx.startedAt === 0 ? 0 : Date.now() - ctx.startedAt, ctx.toolCount, evt.tokens),
      )
      break
    case 'text':
      break
  }
}

function createLineHandler<T>(options: RunAgentOptions<T>): LineHandler {
  const ctx: LiveCtx = {
    label: options.label,
    logPath: options.logPath,
    reporter: options.reporter,
    startedAt: 0,
    toolCount: 0,
    tool: '',
    arg: '',
    seenCalls: new Set<string>(),
    timer: null,
  }
  const onLine: LineSink = (line: string): void => {
    void appendFile(ctx.logPath, `${line}\n`)
    const evt = parseEventLine(line)
    if (evt !== null) {
      applyEvent(evt, ctx)
    }
  }
  const dispose = (): void => {
    if (ctx.timer !== null) {
      clearInterval(ctx.timer)
    }
    const reporter = ctx.reporter
    if (reporter !== undefined) {
      reporter.clearLive()
    }
  }
  return { onLine, dispose }
}

export function agentWritePath(outputPath: string): string {
  return path.join('.review-loop', path.basename(outputPath))
}

function attemptRun<T>(options: RunAgentOptions<T>, onLine?: LineSink): Promise<SpawnResult> {
  return options.spawn(
    'opencode',
    [
      'run',
      '--auto',
      '--format',
      'json',
      '--model',
      options.model,
      '--dir',
      options.cwd,
      ...options.extraArgs,
      options.prompt,
    ],
    { cwd: options.cwd, timeout: options.timeoutMs },
    onLine,
  )
}

async function runAttempt<T>(options: RunAgentOptions<T>): Promise<Attempt<T>> {
  const handler = createLineHandler(options)
  try {
    await mkdir(path.resolve(options.cwd, '.review-loop'), { recursive: true })
    const result = await attemptRun(options, handler.onLine)
    if (result.exitCode !== 0) {
      await appendFile(options.logPath, `[${options.label}] stderr: ${result.stderr}\n`)
      return {
        ok: false,
        error: new Error(`${options.label} exited with code ${result.exitCode}: ${result.stderr}`),
        timedOut: result.timedOut === true,
      }
    }
    try {
      const agentFile = path.resolve(options.cwd, agentWritePath(options.outputPath))
      await copyFile(agentFile, options.outputPath)
      await unlink(agentFile)
      const raw = await readFile(options.outputPath, 'utf8')
      return { ok: true, value: options.outputSchema.parse(JSON.parse(raw)) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error : new Error(String(error)), timedOut: false }
    }
  } finally {
    handler.dispose()
  }
}

export async function runAgent<T>(options: RunAgentOptions<T>): Promise<T> {
  const first = await runAttempt(options)
  if (first.ok) {
    return first.value
  }

  if (first.timedOut) {
    throw first.error
  }

  if (options.onRetry !== undefined) {
    options.onRetry()
  }
  const second = await runAttempt(options)
  if (second.ok) {
    return second.value
  }

  throw second.error
}
