// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { observeActiveFeatureUsed } from '../analytics/feature-observer.js'
import type { ReplyFn, StatusHandle } from '../chat/types.js'
import { logger } from '../logger.js'
import { createStatusEngine, THINKING } from './status-engine.js'
import type { StatusEngine } from './status-engine.js'
import { formatToolStatus } from './tool-status-labels.js'

const log = logger.child({ scope: 'live-status:reporter' })

/**
 * Placeholder shown once the model's tool phase ends, held in place while the final answer is
 * prepared/verified and until the first reply message is actually sent — closes the visible gap
 * between deleting the tool status and posting the reply.
 */
export const PREPARING_RESPONSE = '💬 Preparing response…'
/** A tool label is held at least this long before reverting to "Thinking…", to avoid flicker on fast tools. */
const DEFAULT_MIN_LABEL_MS = 1000

/** Owns a single ephemeral status message for one turn. All methods are best-effort and never throw. */
export type LiveStatusReporter = {
  /** Create the status message (Thinking placeholder). Safe to await even when unsupported. */
  start: () => Promise<void>
  /** A tool started executing. */
  onToolStart: (event: { toolName: string; input: unknown }) => void
  /** A tool finished executing. */
  onToolFinish: () => void
  /**
   * Replace the status message with a sticky placeholder that survives until {@link dismiss}: stops all
   * tool-driven updates so it never flickers. Safe to await even when unsupported. Idempotent.
   */
  placeholder: (text: string) => Promise<void>
  /** Delete the status message. Idempotent. */
  dismiss: () => Promise<void>
}

/** Options for {@link createLiveStatusReporter}. */
export type LiveStatusReporterOptions = {
  /** When false, the reporter is fully inert — no status message is ever created. Defaults to true. */
  enabled?: boolean
  /** Minimum time (ms) a tool label stays visible before reverting to "Thinking…". Defaults to 1000. */
  minLabelMs?: number
  /** Injectable monotonic clock; defaults to {@link Date.now}. Exists so tests need no real timers. */
  now?: () => number
  /** Injectable one-shot timer returning a cancel fn; defaults to {@link setTimeout}/{@link clearTimeout}. */
  schedule?: (fn: () => void, ms: number) => () => void
  /** Content-free lifecycle observer; receives bounded stage/opportunity events only. */
  analytics?: LiveStatusAnalyticsObserver
  /** Monotonic turn-start anchor used for lifecycle latencies; defaults to reporter creation time. */
  turnStartedAtMs?: number
}

export type LiveStatusOpportunityReason =
  | 'eligible'
  | 'platform_unsupported'
  | 'disabled'
  | 'turn_too_short'
  | 'no_status_surface'

export type LiveStatusLifecycleStage = 'create' | 'update' | 'dismiss'

/**
 * Content-free observer for the live-status surface. Payloads carry only bounded
 * stage/reason/outcome values, per-stage ordinals, and turn-relative latency —
 * never status text, tool names, or message content.
 */
export type LiveStatusAnalyticsObserver = Readonly<{
  onOpportunity: (event: Readonly<{ eligible: boolean; reason: LiveStatusOpportunityReason }>) => void
  onLifecycle: (
    event: Readonly<{
      stage: LiveStatusLifecycleStage
      outcome: 'success' | 'failed'
      latencyFromTurnStartMs: number
      ordinal: number
    }>,
  ) => void
}>

/** A status dismissed faster than this after creation never became meaningful feedback. */
const TOO_SHORT_MS = 1000

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms)
  return (): void => {
    clearTimeout(id)
  }
}

type MutableReporterState = {
  handle: StatusHandle | undefined
  /** Once frozen (placeholder shown), tool-driven engine emits are ignored so the placeholder never flickers. */
  frozen: boolean
  createdAtMs: number | undefined
}

type AnalyticsRecorder = Readonly<{
  recordLifecycle: (stage: LiveStatusLifecycleStage, outcome: 'success' | 'failed') => void
  emitOpportunity: (eligible: boolean, reason: LiveStatusOpportunityReason) => void
  /** Observe one status-text update attempt, recording its bounded outcome. */
  recordUpdate: (update: Promise<void>) => void
}>

const createAnalyticsRecorder = (
  analytics: LiveStatusAnalyticsObserver | undefined,
  clock: () => number,
  turnAnchorMs: number,
): AnalyticsRecorder => {
  let opportunityEmitted = false
  const stageOrdinals: Record<LiveStatusLifecycleStage, number> = { create: 0, update: 0, dismiss: 0 }
  const notify = (fn: () => void): void => {
    try {
      fn()
    } catch (error) {
      log.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'Live-status analytics observer failed',
      )
    }
  }
  const recordLifecycle = (stage: LiveStatusLifecycleStage, outcome: 'success' | 'failed'): void => {
    if (analytics === undefined) return
    const ordinal = stageOrdinals[stage]
    stageOrdinals[stage] += 1
    const latencyFromTurnStartMs = Math.max(0, Math.round(clock() - turnAnchorMs))
    notify(() => {
      analytics.onLifecycle({ stage, outcome, latencyFromTurnStartMs, ordinal })
    })
  }
  return {
    recordLifecycle,
    emitOpportunity: (eligible, reason) => {
      if (analytics === undefined || opportunityEmitted) return
      opportunityEmitted = true
      notify(() => {
        analytics.onOpportunity({ eligible, reason })
      })
    },
    recordUpdate: (update) => {
      void update.then(
        () => {
          recordLifecycle('update', 'success')
        },
        () => {
          recordLifecycle('update', 'failed')
        },
      )
    },
  }
}

const startStatus = async (
  reply: ReplyFn,
  enabled: boolean,
  state: MutableReporterState,
  engine: StatusEngine,
  recorder: AnalyticsRecorder,
  clock: () => number,
): Promise<void> => {
  if (!enabled) {
    recorder.emitOpportunity(false, 'disabled')
    return
  }
  if (reply.createStatus === undefined) {
    observeActiveFeatureUsed({ feature: 'live_status', operation: 'create', outcome: 'blocked' })
    recorder.emitOpportunity(false, 'platform_unsupported')
    return
  }
  const created = await reply.createStatus(THINKING).catch(() => undefined)
  if (created === undefined) {
    observeActiveFeatureUsed({ feature: 'live_status', operation: 'create', outcome: 'failure' })
    recorder.recordLifecycle('create', 'failed')
    recorder.emitOpportunity(false, 'no_status_surface')
    return
  }
  state.handle = created
  state.createdAtMs = clock()
  observeActiveFeatureUsed({ feature: 'live_status', operation: 'create', outcome: 'success' })
  recorder.recordLifecycle('create', 'success')
  engine.reset()
}

const placeholderStatus = async (
  text: string,
  state: MutableReporterState,
  engine: StatusEngine,
  recorder: AnalyticsRecorder,
): Promise<void> => {
  engine.stop()
  state.frozen = true
  if (state.handle === undefined) return
  const current = state.handle
  await current.update(text).then(
    () => {
      recorder.recordLifecycle('update', 'success')
    },
    () => {
      recorder.recordLifecycle('update', 'failed')
    },
  )
}

const dismissStatus = async (
  state: MutableReporterState,
  engine: StatusEngine,
  recorder: AnalyticsRecorder,
  clock: () => number,
): Promise<void> => {
  engine.stop()
  if (state.handle === undefined) return
  const current = state.handle
  state.handle = undefined
  let ok = true
  await current.dismiss().catch(() => {
    ok = false
  })
  recorder.recordLifecycle('dismiss', ok ? 'success' : 'failed')
  if (state.createdAtMs !== undefined) {
    const visibleMs = Math.max(0, clock() - state.createdAtMs)
    const eligible = visibleMs >= TOO_SHORT_MS
    recorder.emitOpportunity(eligible, eligible ? 'eligible' : 'turn_too_short')
  }
}

export function createLiveStatusReporter(reply: ReplyFn, options?: LiveStatusReporterOptions): LiveStatusReporter {
  const enabled = options?.enabled !== false
  const clock = options?.now ?? ((): number => Date.now())
  const recorder = createAnalyticsRecorder(options?.analytics, clock, options?.turnStartedAtMs ?? clock())
  const state: MutableReporterState = { handle: undefined, frozen: false, createdAtMs: undefined }
  const engine = createStatusEngine({
    emit: (text): void => {
      if (state.frozen || state.handle === undefined) return
      recorder.recordUpdate(state.handle.update(text))
    },
    isActive: (): boolean => state.handle !== undefined,
    minLabelMs: options?.minLabelMs ?? DEFAULT_MIN_LABEL_MS,
    now: clock,
    schedule: options?.schedule ?? defaultSchedule,
  })

  return {
    start: () => startStatus(reply, enabled, state, engine, recorder, clock),
    onToolStart: (event): void => {
      engine.onToolStart(formatToolStatus(event.toolName, event.input))
    },
    onToolFinish: (): void => {
      engine.onToolFinish()
    },
    placeholder: (text) => placeholderStatus(text, state, engine, recorder),
    dismiss: () => dismissStatus(state, engine, recorder, clock),
  }
}
