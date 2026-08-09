// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describeActivity } from './activity.js'
import type { Activity } from './activity.js'
import { describeDetail } from './activity-detail.js'
import type { TranscriptRow } from './activity-detail.js'
import type { Logger } from './logger.js'

/**
 * Turning a silent model turn into a legible Actions log.
 *
 * An implement phase can run for twenty minutes emitting nothing at all, which
 * in a CI log is indistinguishable from a hang — and the usual response to a
 * job that looks hung is to cancel it, losing the whole run. OpenCode publishes
 * an event stream describing what it is doing; `activity.ts` decides what each
 * event means and what of it may be repeated, and this reports it.
 *
 * Two halves, because they answer different questions. Events answer "what
 * happened", and only fire when something does; the heartbeat answers "is it
 * still alive", which is the question a twenty-minute model call with no tool
 * use leaves open.
 */

/** What a heartbeat reports when there is nothing new to say. */
export interface ProgressSnapshot {
  lastAction: string
  toolCalls: number
  tokens: number
  cost: number
}

export interface ProgressTracker {
  observe: (event: unknown) => void
  snapshot: () => ProgressSnapshot
}

/** The encrypted transcript's write end, as the tracker sees it. */
export interface TranscriptSink {
  write: (row: TranscriptRow) => void
}

export interface ProgressTrackerOptions {
  /**
   * The clock a duration is measured on, defaulting to the real one. Injected
   * so a test can stand on both sides of a call rather than sampling
   * `Date.now()` around it.
   */
  now?: () => number
  /**
   * Where the maintainer-only detail goes, when the run has a key.
   *
   * Fed from `activity-detail.ts` — the whitelist decoder — so the detail that
   * leaves this process is a property of the decoder, not of a call site.
   * Absent on a keyless run, which is the ordinary case and costs nothing.
   */
  transcript?: TranscriptSink
}

/** One decimal place: `3.2s` — a duration is orientation, not measurement. */
const formatDuration = (ms: number): string => `${(ms / 1_000).toFixed(1)}s`

/**
 * The line one activity earns, or `null` for one that earns none.
 *
 * Two lines per tool call and no more: `▸ bash (running)` when it starts and
 * `✓ bash 3.2s` when it ends, with `✗` for a failed one. A completion whose
 * start was never seen carries no duration — the tracker's clock is the only
 * honest source, since `state.time.start` belongs to the server's clock.
 *
 * Plain text, with the metadata left empty: the pretty line is the message,
 * so a NDJSON renderer adds no structure and a text renderer loses nothing.
 * Names, statuses, counts and durations only — the containment rule from
 * `activity.ts` applies to the line exactly as it applied to the metadata.
 */
const toolLine = (activity: Activity, durationMs: number | null): string => {
  const tool = String(activity.meta['tool'])
  const status = String(activity.meta['status'])
  if (status === 'running') return `▸ ${tool} (running)`
  const duration = durationMs === null ? '' : ` ${formatDuration(durationMs)}`
  return `${status === 'error' ? '✗' : '✓'} ${tool}${duration}`
}

const statusLine = (activity: Activity): string => {
  const status = String(activity.meta['status'])
  const attempt = activity.meta['attempt']
  return attempt === undefined ? `● ${status}` : `● ${status} (attempt ${attempt})`
}

/**
 * Logs each decoded event and keeps a running summary for the heartbeat.
 *
 * The summary matters more than it looks. Events answer "what happened"; the
 * heartbeat answers "is it still alive", and a heartbeat that only says "still
 * working" is barely better than silence. Carrying the last action and the
 * running totals makes a quiet twenty-minute stretch readable as *waiting on
 * one long model call* rather than as *stuck*.
 */
export const createProgressTracker = (sessionId: string, log: Logger, options: ProgressTrackerOptions = {}): ProgressTracker => {
  const now = options.now ?? ((): number => Date.now())
  let lastAction = 'starting'
  let toolCalls = 0
  let tokens = 0
  let cost = 0
  let lastCollapsed: string | null = null
  /** Running calls by callID, stamped on this clock: the duration's only source. */
  const running = new Map<string, number>()

  const observeTool = (activity: Activity): { line: string; durationMs: number | null } | null => {
    const call = String(activity.meta['call'])
    const status = String(activity.meta['status'])
    if (status === 'running') {
      // The server republishes the running state as the arguments stream in;
      // ten republishes of one call are one call, one line and one count.
      if (running.has(call)) return null
      running.set(call, now())
      toolCalls += 1
      return { line: toolLine(activity, null), durationMs: null }
    }

    const started = running.get(call)
    running.delete(call)
    const durationMs = started === undefined ? null : now() - started
    return { line: toolLine(activity, durationMs), durationMs }
  }

  const feedTranscript = (event: unknown, activity: Activity, durationMs: number | null): void => {
    if (options.transcript === undefined) return
    const detail = describeDetail(event, sessionId)
    if (detail === null) return
    options.transcript.write({
      time: new Date(now()).toISOString(),
      tool: detail.tool,
      status: String(activity.meta['status']),
      detail: detail.detail,
      durationMs,
    })
  }

  return {
    observe: (event): void => {
      const activity = describeActivity(event, sessionId)
      if (activity === null) return

      // `busy` is republished between every step; without this a hundred-step
      // turn writes a hundred identical lines and buries the tool calls.
      if (activity.collapseKey !== undefined) {
        if (activity.collapseKey === lastCollapsed) return
        lastCollapsed = activity.collapseKey
      }

      tokens += activity.counts?.tokens ?? 0
      cost += activity.counts?.cost ?? 0
      lastAction = activity.summary

      if (activity.kind === 'tool') {
        const observed = observeTool(activity)
        if (observed === null) return
        feedTranscript(event, activity, observed.durationMs)
        log.info({}, observed.line)
        return
      }

      if (activity.kind === 'step') {
        log.info({}, `✓ finished a step — ${tokens} tokens, ${toolCalls} tool calls so far`)
        return
      }

      log.info({}, statusLine(activity))
    },
    snapshot: (): ProgressSnapshot => ({ lastAction, toolCalls, tokens, cost }),
  }
}

export interface EventFollower {
  /** Resolves when the stream ends, however it ends. Never rejects. */
  done: Promise<void>
  /** Asks the stream to finish. Safe to call more than once. */
  stop: () => void
}

/**
 * Drains an event stream into a tracker until it ends or is stopped.
 *
 * `for await` rather than the repo's `sequence.ts` helpers, which iterate a
 * collection already in hand: this consumes an open stream of unknown length,
 * which is the one case the no-`await`-in-a-loop rule exempts.
 *
 * `done` never rejects. The stream dies whenever the OpenCode server does —
 * including during an ordinary `close()` — and a teardown race must not become
 * an unhandled rejection that fails a run whose work is already finished.
 *
 * `stop` exists because a stream is not guaranteed to notice that its server is
 * gone. The SDK's SSE client reconnects for ever by default, so "wait for the
 * events to run out" is not a teardown step a caller can rely on; it has to be
 * able to say stop and move on.
 */
export const followEvents = (source: AsyncIterable<unknown>, tracker: ProgressTracker): EventFollower => {
  const iterator = source[Symbol.asyncIterator]()
  let stopped = false

  const drain = async (): Promise<void> => {
    try {
      for await (const event of { [Symbol.asyncIterator]: () => iterator }) {
        if (stopped) break
        tracker.observe(event)
      }
    } catch {
      // The stream ending badly tells us nothing the caller can act on.
    }
  }

  return {
    done: drain(),
    stop: (): void => {
      stopped = true
      // Unblocks a `next()` that is waiting on a socket nobody will write to.
      void iterator.return?.(undefined)
    },
  }
}

export interface HeartbeatOptions {
  everyMs: number
  log: Logger
  snapshot: () => ProgressSnapshot
  /** Injected so a test does not spend real minutes proving this ticks. */
  schedule?: (tick: () => void, everyMs: number) => { cancel: () => void }
  /**
   * A second reader of the same tick, when one is wired.
   *
   * The heartbeat already knows everything a live status surface wants to say
   * and, until now, said it only into a log nobody has a link to. Routing the
   * snapshot rather than duplicating the timer keeps one clock in the pipeline,
   * and keeps the two readers from ever disagreeing about what a turn has done.
   *
   * The log half is unchanged and stays first: a reader that throws or hangs
   * must not cost the line that was already being written. Nothing here awaits
   * it either — the heartbeat's job is to fire on time, not to wait for whatever
   * the tick is being reported to.
   */
  onTick?: (snapshot: ProgressSnapshot) => void
}

const realSchedule = (tick: () => void, everyMs: number): { cancel: () => void } => {
  const timer = setInterval(tick, everyMs)
  return {
    cancel: (): void => {
      clearInterval(timer)
    },
  }
}

/**
 * Says "still going, and here is what it has done so far" at a fixed interval
 * while `work` is outstanding.
 *
 * This is the half that actually answers the finding. Events only fire when
 * something happens, and the worst case — a single model call that thinks for
 * twenty minutes — produces no events at all, which is exactly the stretch that
 * reads as a hang. A tick that fires regardless is the only thing that
 * distinguishes "slow" from "dead" in a log.
 *
 * Must wrap the deadline rather than sit inside it: if the deadline rejects
 * while the underlying call is still pending, an inner heartbeat's cleanup
 * would never run and the interval would keep the process alive past the end of
 * the job.
 */
export const withHeartbeat = async <T>(work: Promise<T>, options: HeartbeatOptions): Promise<T> => {
  if (options.everyMs <= 0) return work

  const started = Date.now()
  const schedule = options.schedule ?? realSchedule
  const timer = schedule(() => {
    const progress = options.snapshot()
    options.log.info(
      { elapsedMs: Date.now() - started, ...progress },
      'Still waiting on the model; the job is not stuck',
    )
    if (options.onTick !== undefined) options.onTick(progress)
  }, options.everyMs)

  try {
    return await work
  } finally {
    timer.cancel()
  }
}
