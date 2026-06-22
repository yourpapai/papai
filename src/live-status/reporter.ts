// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ReplyFn, StatusHandle } from '../chat/types.js'
import { formatToolStatus } from './tool-status-labels.js'

const THINKING = '💭 Thinking…'
/** A tool label is held at least this long before reverting to {@link THINKING}, to avoid flicker on fast tools. */
const DEFAULT_MIN_LABEL_MS = 1000

/** Owns a single ephemeral status message for one turn. All methods are best-effort and never throw. */
export type LiveStatusReporter = {
  /** Create the status message (Thinking placeholder). Safe to await even when unsupported. */
  start: () => Promise<void>
  /** A tool started executing. */
  onToolStart: (event: { toolName: string; input: unknown }) => void
  /** A tool finished executing. */
  onToolFinish: () => void
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
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms)
  return (): void => {
    clearTimeout(id)
  }
}

type StatusEngineDeps = {
  /** Send a (deduped) text to the live status message; a no-op when no message is active. */
  emit: (text: string) => void
  /** Whether a status message currently exists; gates whether work is scheduled at all. */
  isActive: () => boolean
  minLabelMs: number
  now: () => number
  schedule: (fn: () => void, ms: number) => () => void
}

type StatusEngine = {
  onToolStart: (label: string) => void
  onToolFinish: () => void
  /** Re-baseline the rendered text to Thinking once the status message exists. */
  reset: () => void
  /** Cancel any pending Thinking revert. */
  stop: () => void
}

type EngineState = {
  inFlight: number
  lastStartLabel: string
  lastRendered: string | undefined
  /** When the currently-rendered tool label was first shown; anchors the minimum-hold window. */
  labelShownAt: number
  cancelPending: (() => void) | undefined
}

const stopTimer = (state: EngineState): void => {
  state.cancelPending?.()
  state.cancelPending = undefined
}

const pushText = (state: EngineState, deps: StatusEngineDeps, text: string): void => {
  if (text === state.lastRendered) return
  state.lastRendered = text
  if (text !== THINKING) state.labelShownAt = deps.now()
  deps.emit(text)
}

const activeText = (state: EngineState): string =>
  state.inFlight === 1 ? state.lastStartLabel : `${state.lastStartLabel} (+${state.inFlight - 1})`

/** Reconcile the rendered text with the in-flight count, deferring the Thinking revert by the minimum hold. */
const applyState = (state: EngineState, deps: StatusEngineDeps): void => {
  if (!deps.isActive()) return
  if (state.inFlight >= 1) {
    stopTimer(state)
    pushText(state, deps, activeText(state))
    return
  }
  // No tool in flight: revert to Thinking, but hold a live tool label minLabelMs to avoid fast-tool flicker.
  if (state.lastRendered !== undefined && state.lastRendered !== THINKING) {
    const remaining = deps.minLabelMs - (deps.now() - state.labelShownAt)
    if (remaining > 0) {
      state.cancelPending ??= deps.schedule((): void => {
        state.cancelPending = undefined
        if (state.inFlight <= 0) pushText(state, deps, THINKING)
      }, remaining)
      return
    }
  }
  stopTimer(state)
  pushText(state, deps, THINKING)
}

/** Drives the in-flight count → status text, holding a tool label for `minLabelMs` before reverting to Thinking. */
const createStatusEngine = (deps: StatusEngineDeps): StatusEngine => {
  const state: EngineState = {
    inFlight: 0,
    lastStartLabel: THINKING,
    lastRendered: undefined,
    labelShownAt: 0,
    cancelPending: undefined,
  }
  return {
    onToolStart: (label): void => {
      state.inFlight += 1
      state.lastStartLabel = label
      applyState(state, deps)
    },
    onToolFinish: (): void => {
      state.inFlight = Math.max(0, state.inFlight - 1)
      applyState(state, deps)
    },
    reset: (): void => {
      state.lastRendered = THINKING
    },
    stop: (): void => {
      stopTimer(state)
    },
  }
}

export function createLiveStatusReporter(reply: ReplyFn, options?: LiveStatusReporterOptions): LiveStatusReporter {
  const enabled = options?.enabled !== false
  let handle: StatusHandle | undefined
  const engine = createStatusEngine({
    emit: (text): void => {
      void handle?.update(text).catch(() => undefined)
    },
    isActive: (): boolean => handle !== undefined,
    minLabelMs: options?.minLabelMs ?? DEFAULT_MIN_LABEL_MS,
    now: options?.now ?? ((): number => Date.now()),
    schedule: options?.schedule ?? defaultSchedule,
  })

  return {
    start: async (): Promise<void> => {
      if (!enabled) return
      if (reply.createStatus === undefined) return
      handle = await reply.createStatus(THINKING).catch(() => undefined)
      if (handle !== undefined) engine.reset()
    },
    onToolStart: (event): void => {
      engine.onToolStart(formatToolStatus(event.toolName, event.input))
    },
    onToolFinish: (): void => {
      engine.onToolFinish()
    },
    dismiss: async (): Promise<void> => {
      engine.stop()
      if (handle === undefined) return
      const current = handle
      handle = undefined
      await current.dismiss().catch(() => undefined)
    },
  }
}
