// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { appendFile } from 'node:fs/promises'

import { emptyUsage, type AgentUsage, type LineSink, type RunAgentOptions } from './agent-runner.js'
import { scrubCredentialValue } from './backend-select.js'
import { type OpencodeEvent, parseEventLine, sessionIdOfLine } from './event-stream.js'
import { formatLiveLine, formatToolArg } from './live-format.js'
import type { ProgressReporter } from './progress-log.js'

export interface LineHandler {
  readonly ctx: LiveCtx
  onLine: LineSink
  /**
   * The line decoder this handler applies. Re-armable per attempt (D6): the
   * claude decoder's tool-pairing map and result outcome are attempt state,
   * and `runAttempt` replaces it beside `ctx.sessionId` so a stall retry never
   * reads the stalled attempt's result line as its own.
   */
  decoder: EventDecoder
  /** Clears live rendering and resolves after every queued log write has hit disk. */
  dispose: () => Promise<void>
}

/**
 * One backend's NDJSON line decode: zero or more events per line (a claude
 * message carries a content *array*, so one line can yield several tool_use
 * events) plus the session-id read. The result-outcome read is what the
 * claude route's exit-0 gate consults; the opencode adapter answers "not
 * seen" (opencode has no result-line contract).
 */
export interface EventDecoder {
  parseLine(line: string): OpencodeEvent[]
  sessionIdOf(line: string): string | null
  resultOutcome(): { seen: boolean; isError: boolean }
}

/** The opencode adapter: the existing single-event pair, list-wrapped (D6). */
export const opencodeEventDecoder: EventDecoder = {
  parseLine: (line): OpencodeEvent[] => {
    const evt = parseEventLine(line)
    return evt === null ? [] : [evt]
  },
  sessionIdOf: sessionIdOfLine,
  resultOutcome: () => ({ seen: false, isError: false }),
}

/**
 * Session-capture seam (D1): the host records the opencode session id the
 * moment the first session-bearing line arrives. Best-effort — an error here
 * must never fail event processing.
 */
export interface SessionLedgerSeam {
  recordSessionId: (opencodeSessionId: string, attempt: number) => unknown
}

export interface LiveCtx {
  readonly label: string
  readonly slotKey: string
  readonly commitOnDispose: boolean
  readonly model: string
  readonly logPath: string
  readonly reporter: ProgressReporter | undefined
  readonly sessionLedger: SessionLedgerSeam | undefined
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
  /** Preferred ledger attempt for this spawn; the id is recorded exactly once per handler. */
  sessionAttempt: number
  sessionId: string | null
  /**
   * The selected credential's value on the claude route, threaded from the
   * `claude` context so `enqueueLog` — the single sink both callers write
   * through — can scrub it from every line it persists (D5). `null` on the
   * opencode route, which logs verbatim.
   */
  credentialValue: string | null
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

/**
 * Record the spawn's opencode session id the first time a session-bearing
 * line arrives (D1). Idempotent per handler; best-effort — a ledger error
 * must never fail event processing.
 */
function captureSessionId(ctx: LiveCtx, decoder: EventDecoder, line: string): void {
  const sessionId = decoder.sessionIdOf(line)
  if (sessionId === null || ctx.sessionId !== null) return
  ctx.sessionId = sessionId
  try {
    ctx.sessionLedger?.recordSessionId(sessionId, ctx.sessionAttempt)
  } catch {
    // best-effort: capture must never fail event processing
  }
}

export function createLineHandler<T>(
  options: RunAgentOptions<T>,
  decoder: EventDecoder = opencodeEventDecoder,
): LineHandler {
  const ctx: LiveCtx = {
    label: options.label,
    slotKey: options.slotKey ?? options.label,
    commitOnDispose: options.commitOnDispose ?? true,
    model: options.model,
    logPath: options.logPath,
    reporter: options.reporter,
    sessionLedger: options.sessionLedger,
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
    sessionAttempt: options.sessionAttempt ?? 1,
    sessionId: null,
    credentialValue: options.claude?.credentialValue ?? null,
  }
  const handler: LineHandler = {
    ctx,
    decoder,
    onLine: (line: string): void => {
      enqueueLog(ctx, `${line}\n`)
      captureSessionId(ctx, handler.decoder, line)
      for (const evt of handler.decoder.parseLine(line)) {
        applyEvent(evt, ctx)
      }
    },
    dispose: async (): Promise<void> => {
      if (ctx.timer !== null) {
        clearInterval(ctx.timer)
      }
      commitSlotOnDispose(ctx)
      await ctx.logChain
    },
  }
  return handler
}

function commitSlotOnDispose(ctx: LiveCtx): void {
  const reporter = ctx.reporter
  if (reporter === undefined) return
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

/**
 * Best-effort serialized log append, scrubbed of the selected credential's
 * value inside the sink itself (D5): both callers — every raw NDJSON line and
 * the attempt's stderr line — write through here, so coverage is by
 * construction, not by auditing call sites. A fire-and-forget
 * `void appendFile(...)` floats past the caller's lifetime: if the destination
 * disappears first (temp-dir cleanup, run teardown), the rejection is
 * unhandled and crashes whichever code is running when it lands. Chaining lets
 * `dispose` drain the queue so no write outlives `runAgent`'s finally.
 */
export function enqueueLog(ctx: LiveCtx, text: string): void {
  const scrubbed = scrubCredentialValue(text, ctx.credentialValue)
  ctx.logChain = ctx.logChain
    .then(() => appendFile(ctx.logPath, scrubbed))
    .then(
      () => undefined,
      () => undefined,
    )
}
