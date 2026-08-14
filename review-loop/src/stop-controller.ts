// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * The one bit of state that says "finish what you are holding and stop".
 *
 * A loop that is killed loses everything it has not published: the round it was
 * in, the ledger entry it was about to write, the summary a reader needs to know
 * what happened, and — when `mergeEachFix` is off — every fix on its branch. That
 * is the whole difference between the loop reaching its own bound and the caller
 * reaching one for it, and it is why this exists rather than a `timeout` around
 * the process.
 *
 * The stop is **cooperative and coarse**, deliberately. Nothing here interrupts an
 * agent subprocess, unwinds a rebase or abandons a half-merged worker: those are
 * bounded by `agentTimeoutMs` and are exactly the operations that must not be cut
 * in half. What it does is stop the loop *entering* anything new — the next issue,
 * the next round — which are the two places where the work in hand is committed,
 * the ledger is saved, and stopping costs nothing at all.
 *
 * Two things ask for it. A run budget, for the unattended case: the caller knows
 * when its runner disappears and hands the loop a slice ending before that, so the
 * loop stops itself while it still has time to finalize. And a signal, for the
 * attended one: `SIGTERM` from a caller reclaiming its runner, or the `SIGINT` a
 * developer types — which without a handler kills the run outright, as a caller's
 * kill does. A second signal escalates, because somebody pressing Ctrl-C twice has
 * stopped asking.
 */

export type StopReason = 'budget' | 'signal'

export type StopSignal = 'SIGINT' | 'SIGTERM'

/**
 * The ambient capabilities this needs, as one injected object.
 *
 * A timer and a signal source are the two things a test cannot wait for and must
 * not install globally — a real `SIGINT` handler outlives the test that registered
 * it, and a real 90-minute timer is not something a suite can sit through.
 */
export interface StopHost {
  /** Schedules `fn`, and hands back the one way to cancel it. */
  schedule: (fn: () => void, ms: number) => () => void
  on: (signal: StopSignal, handler: () => void) => void
  off: (signal: StopSignal, handler: () => void) => void
}

export interface StopController {
  /** Why work must stop, or `null` while the run may carry on. */
  requested: () => StopReason | null
  /** Asks for a stop from anywhere else that learns the run is over. */
  request: (reason: StopReason) => void
  /** Releases the timer and the handlers, so the process is free to exit. */
  dispose: () => void
}

export interface StopControllerOptions {
  /** Wall clock for the whole run; `0` disables the budget half entirely. */
  runTimeoutMs: number
  host?: StopHost
  /** Announced once, with the reason that won, so a run can say why it stopped. */
  onStop?: (reason: StopReason) => void
  /** A signal arriving after the stop is already asked for — see the module note. */
  onRepeatedSignal?: () => void
}

/**
 * The budget with the run's own setup already taken off it.
 *
 * The budget belongs to the **caller**, and a caller counts from the moment it
 * spawns this process. Opening a run is not free — a `git worktree add` and a
 * `bun install` for the primary worktree and for every pool worker — so a budget
 * armed when that finishes expires that much later than the caller expects, and
 * the kill sitting a wrap-up slice behind it lands first. The soft stop the whole
 * arrangement exists for would then never fire on exactly the slow runs it is
 * for.
 *
 * Never `0` for a run that had a budget: `0` is how {@link createStopController}
 * spells "no budget at all", so a run whose setup outlived its budget would come
 * back unbounded instead of stopping at once.
 */
export const remainingBudget = (runTimeoutMs: number, elapsedMs: number): number =>
  runTimeoutMs <= 0 ? 0 : Math.max(1, runTimeoutMs - elapsedMs)

const SIGNALS: readonly StopSignal[] = ['SIGINT', 'SIGTERM']

const processHost: StopHost = {
  schedule: (fn, ms) => {
    const timer = setTimeout(fn, ms)
    // The loop is not kept alive *by* its own deadline: a run that finishes early
    // should exit then, not sit on an unfired timer for the rest of the budget.
    timer.unref?.()
    return (): void => {
      clearTimeout(timer)
    }
  },
  on: (signal, handler) => {
    process.on(signal, handler)
  },
  off: (signal, handler) => {
    process.off(signal, handler)
  },
}

export function createStopController(options: StopControllerOptions): StopController {
  const host = options.host ?? processHost
  let reason: StopReason | null = null

  const request = (next: StopReason): void => {
    // First reason wins. What follows a stop is finalization, and a second cause
    // for the same stop would re-announce it and rewrite the account of why.
    if (reason !== null) return
    reason = next
    options.onStop?.(next)
  }

  const onSignal = (): void => {
    if (reason !== null) {
      options.onRepeatedSignal?.()
      return
    }
    request('signal')
  }

  const cancelBudget =
    options.runTimeoutMs > 0
      ? host.schedule(() => {
          request('budget')
        }, options.runTimeoutMs)
      : null
  for (const signal of SIGNALS) host.on(signal, onSignal)

  return {
    requested: () => reason,
    request,
    dispose: (): void => {
      cancelBudget?.()
      for (const signal of SIGNALS) host.off(signal, onSignal)
    },
  }
}
