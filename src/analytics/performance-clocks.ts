// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Performance clocks: the TTFT (time-to-first-token) monotonic clock with its
 * language-model stream wrapper, and the first-visible-feedback tracker that
 * selects the earliest successful user-visible feedback of a turn.
 * All clocks are injectable and content-free: no text, tokens, or provider
 * payloads are ever recorded — only timestamps and controlled outcomes.
 */

import type { LanguageModelV4, LanguageModelV4StreamPart } from '@ai-sdk/provider'
import { wrapLanguageModel } from 'ai'
import type { LanguageModel, LanguageModelMiddleware } from 'ai'

const DEFAULT_MAX_PLAUSIBLE_TTFT_MS = 1_200_000

export type TtftClock = Readonly<{
  /** Stamp the outbound request start. */
  start: () => void
  /** Record the first streamed text delta; later deltas are ignored. */
  recordTextDelta: () => void
  /** Elapsed ms to the first text delta; null when not applicable or implausible. */
  read: () => number | null
}>

export type TtftClockDeps = Readonly<{
  now?: () => number
  maxPlausibleMs?: number
}>

export const createTtftClock = (deps: TtftClockDeps = {}): TtftClock => {
  const now = deps.now ?? ((): number => performance.now())
  const maxPlausibleMs = deps.maxPlausibleMs ?? DEFAULT_MAX_PLAUSIBLE_TTFT_MS
  let startedAtMs: number | null = null
  let firstDeltaAtMs: number | null = null
  return {
    start: () => {
      startedAtMs = now()
      firstDeltaAtMs = null
    },
    recordTextDelta: () => {
      if (startedAtMs === null || firstDeltaAtMs !== null) return
      firstDeltaAtMs = now()
    },
    read: () => {
      if (startedAtMs === null || firstDeltaAtMs === null) return null
      const elapsed = firstDeltaAtMs - startedAtMs
      if (elapsed < 0 || elapsed > maxPlausibleMs) return null
      return Math.round(elapsed)
    },
  }
}

const isV4Model = (model: LanguageModel): model is LanguageModelV4 =>
  typeof model !== 'string' && model.specificationVersion === 'v4'

/**
 * Wrap a language model so the first streamed `text-delta` trips the TTFT clock.
 * Non-streaming (`doGenerate`) calls never record a delta — TTFT stays null.
 * Runtime models are always provider objects (never string ids), so the
 * LanguageModel union narrows to the V4 surface the orchestrator drives.
 */
export const wrapModelForTtft = (model: LanguageModel, clock: TtftClock): LanguageModelV4 => {
  if (!isV4Model(model)) throw new Error('wrapModelForTtft requires a LanguageModelV4 instance')
  const middleware: LanguageModelMiddleware = {
    wrapStream: async ({ doStream }) => {
      const result = await doStream()
      const observed: ReadableStream<LanguageModelV4StreamPart> = result.stream.pipeThrough(
        new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
          transform(part, controller) {
            if (part.type === 'text-delta') clock.recordTextDelta()
            controller.enqueue(part)
          },
        }),
      )
      return { ...result, stream: observed }
    },
  }
  return wrapLanguageModel({ model, middleware })
}

export type FeedbackKind = 'typing' | 'live_status' | 'steer_ack'

export type FirstVisibleFeedbackResult = Readonly<{
  kind: FeedbackKind | 'none'
  outcome: 'success' | 'failed' | 'missing' | 'not_applicable'
  latencyMs: number | null
}>

export type FirstVisibleFeedbackTrackerDeps = Readonly<{
  now?: () => number
  /** Monotonic turn-start anchor; defaults to tracker creation time. */
  startedAtMs?: number
  capabilitySupported?: boolean
  settingEnabled?: boolean
}>

export type FirstVisibleFeedbackTracker = Readonly<{
  /** Record one feedback attempt; the earliest success wins, later records never downgrade it. */
  record: (kind: FeedbackKind, outcome: 'success' | 'failed') => void
  /** Close at the turn terminal; idempotent — later calls return the frozen result. */
  close: () => FirstVisibleFeedbackResult
}>

/**
 * Selects the earliest successful user-visible feedback of a turn. At the
 * terminal the tracker closes exactly once: success with latency when a kind
 * won, `failed` when every attempt failed, `missing` when nothing was attempted
 * although the surface was supported and enabled, otherwise `not_applicable`.
 */
export const createFirstVisibleFeedbackTracker = (
  deps: FirstVisibleFeedbackTrackerDeps = {},
): FirstVisibleFeedbackTracker => {
  const now = deps.now ?? ((): number => performance.now())
  const startedAtMs = deps.startedAtMs ?? now()
  const capabilitySupported = deps.capabilitySupported === true
  const settingEnabled = deps.settingEnabled === true
  let winner: Readonly<{ kind: FeedbackKind; atMs: number }> | null = null
  let failedAttempts = 0
  let closed: FirstVisibleFeedbackResult | null = null
  return {
    record: (kind, outcome) => {
      if (closed !== null || winner !== null) return
      if (outcome === 'success') {
        winner = { kind, atMs: now() }
        return
      }
      failedAttempts += 1
    },
    close: () => {
      if (closed !== null) return closed
      if (winner !== null) {
        const latencyMs = Math.max(0, Math.round(winner.atMs - startedAtMs))
        closed = { kind: winner.kind, outcome: 'success', latencyMs }
        return closed
      }
      if (failedAttempts > 0) {
        closed = { kind: 'none', outcome: 'failed', latencyMs: null }
        return closed
      }
      closed =
        capabilitySupported && settingEnabled
          ? { kind: 'none', outcome: 'missing', latencyMs: null }
          : { kind: 'none', outcome: 'not_applicable', latencyMs: null }
      return closed
    },
  }
}
