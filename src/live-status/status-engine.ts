// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The live-status text engine: drives the in-flight tool count to status text,
 * holding a tool label for `minLabelMs` before reverting to Thinking so fast
 * tools never flicker. All scheduling and clocks are injectable.
 */

export const THINKING = '💭 Thinking…'

export type StatusEngineDeps = {
  /** Send a (deduped) text to the live status message; a no-op when no message is active. */
  emit: (text: string) => void
  /** Whether a status message currently exists; gates whether work is scheduled at all. */
  isActive: () => boolean
  minLabelMs: number
  now: () => number
  schedule: (fn: () => void, ms: number) => () => void
}

export type StatusEngine = {
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
export const createStatusEngine = (deps: StatusEngineDeps): StatusEngine => {
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
