// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile } from 'node:fs/promises'

import { emptyUsage, type AgentUsage, type LineSink, type RunAgentOptions } from './agent-runner.js'
import { type OpencodeEvent, parseEventLine } from './event-stream.js'
import { formatLiveLine, formatToolArg } from './live-format.js'
import type { ProgressReporter } from './progress-log.js'

export interface LineHandler {
  readonly ctx: LiveCtx
  onLine: LineSink
  /** Clears live rendering and resolves after every queued log write has hit disk. */
  dispose: () => Promise<void>
}

export interface LiveCtx {
  readonly label: string
  readonly slotKey: string
  readonly commitOnDispose: boolean
  readonly model: string
  readonly logPath: string
  readonly reporter: ProgressReporter | undefined
  startedAt: number
  toolCount: number
  reportedToolCalls: number
  tool: string
  arg: string
  readonly seenCalls: Set<string>
  timer: ReturnType<typeof setInterval> | null
  usage: AgentUsage
  firstStepAt: number | null
  /** Serializes log appends so `dispose` can drain them; never rejects (logging is best-effort). */
  logChain: Promise<void>
}

function liveLine(ctx: LiveCtx, done: boolean): string {
  const elapsed = ctx.startedAt === 0 ? 0 : Date.now() - ctx.startedAt
  return formatLiveLine(
    ctx.label,
    ctx.tool,
    ctx.arg,
    elapsed,
    ctx.toolCount,
    {
      input: ctx.usage.inputTokens,
      output: ctx.usage.outputTokens,
      cached: ctx.usage.cachedReadTokens,
    },
    done,
  )
}

function renderLive(ctx: LiveCtx): void {
  const reporter = ctx.reporter
  if (reporter === undefined) {
    return
  }
  const line = liveLine(ctx, false)
  if (reporter.slot === undefined) {
    reporter.live([line])
  } else {
    reporter.slot(ctx.slotKey, line)
  }
}

function applyStepFinish(evt: Extract<OpencodeEvent, { type: 'step_finish' }>, ctx: LiveCtx): void {
  const reporter = ctx.reporter
  ctx.usage.inputTokens += evt.tokens.input
  ctx.usage.outputTokens += evt.tokens.output
  ctx.usage.reasoningTokens += evt.tokens.reasoning
  ctx.usage.cachedReadTokens += evt.tokens.cacheRead
  ctx.usage.cachedWriteTokens += evt.tokens.cacheWrite
  ctx.usage.costUsd += evt.cost
  if (reporter === undefined) return
  reporter.usage?.({
    input: evt.tokens.input,
    output: evt.tokens.output,
    reasoning: evt.tokens.reasoning,
    cacheRead: evt.tokens.cacheRead,
    cacheWrite: evt.tokens.cacheWrite,
    cost: evt.cost,
    label: ctx.label,
    model: ctx.model,
  })
  const newToolCalls = ctx.toolCount - ctx.reportedToolCalls
  if (newToolCalls > 0) {
    ctx.reportedToolCalls = ctx.toolCount
    reporter.stats?.addToolCalls(ctx.label, newToolCalls)
  }
  renderLive(ctx)
}

function applyEvent(evt: OpencodeEvent, ctx: LiveCtx): void {
  const reporter = ctx.reporter
  switch (evt.type) {
    case 'step_start':
      ctx.firstStepAt ??= Date.now()
      if (ctx.startedAt === 0) {
        ctx.startedAt = Date.now()
        if (reporter?.dynamic === true) {
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
      applyStepFinish(evt, ctx)
      break
    case 'text':
      break
  }
}

export function createLineHandler<T>(options: RunAgentOptions<T>): LineHandler {
  const ctx: LiveCtx = {
    label: options.label,
    slotKey: options.slotKey ?? options.label,
    commitOnDispose: options.commitOnDispose ?? true,
    model: options.model,
    logPath: options.logPath,
    reporter: options.reporter,
    startedAt: 0,
    toolCount: 0,
    reportedToolCalls: 0,
    tool: '',
    arg: '',
    seenCalls: new Set<string>(),
    timer: null,
    usage: emptyUsage(),
    firstStepAt: null,
    logChain: Promise.resolve(),
  }
  const onLine: LineSink = (line: string): void => {
    enqueueLog(ctx, `${line}\n`)
    const evt = parseEventLine(line)
    if (evt !== null) {
      applyEvent(evt, ctx)
    }
  }
  const dispose = async (): Promise<void> => {
    if (ctx.timer !== null) {
      clearInterval(ctx.timer)
    }
    const reporter = ctx.reporter
    if (reporter !== undefined) {
      if (reporter.slot === undefined) {
        reporter.clearLive()
      } else if (ctx.commitOnDispose && ctx.startedAt !== 0 && reporter.commit !== undefined) {
        reporter.commit(ctx.slotKey, liveLine(ctx, true))
      } else if (ctx.commitOnDispose) {
        // Never started (died before the first step) or the reporter predates
        // commit(): nothing worth freezing — clear instead.
        reporter.slot(ctx.slotKey, null)
      }
      // commitOnDispose === false: leave the slot live for the unit's owner.
    }
    await ctx.logChain
  }
  return { ctx, onLine, dispose }
}

/**
 * Best-effort serialized log append. A fire-and-forget `void appendFile(...)` floats past the
 * caller's lifetime: if the destination disappears first (temp-dir cleanup, run teardown), the
 * rejection is unhandled and crashes whichever code is running when it lands. Chaining lets
 * `dispose` drain the queue so no write outlives `runAgent`'s finally.
 */
export function enqueueLog(ctx: LiveCtx, text: string): void {
  ctx.logChain = ctx.logChain
    .then(() => appendFile(ctx.logPath, text))
    .then(
      () => undefined,
      () => undefined,
    )
}
