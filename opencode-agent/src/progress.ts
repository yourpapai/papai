// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describeDetail } from './activity-detail.js'
import type { TranscriptRow } from './activity-detail.js'
import { describeActivity } from './activity.js'
import type { Activity } from './activity.js'
import type { Logger } from './logger.js'
import { foldStall, noStall, reportStall } from './turn-stall.js'
import type { TurnStall } from './turn-stall.js'

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
 * use leaves open. This file is the first half; `heartbeat.ts` is the second,
 * split off when the transcript sink pushed the pair past `max-lines` — it
 * reads this one only through `ProgressSnapshot`, never the other way, so the
 * dependency stays one-directional.
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
  /**
   * What the provider was still doing wrong at this instant, or `null`.
   *
   * Asked when a turn returns, by the one caller that also holds the reply —
   * neither signal is conclusive alone. An empty reply is ordinary enough on
   * its own (a turn can end on a tool call), and a stall that a later step
   * cleared is not a failure at all; together they are a turn that produced
   * nothing because the model never answered.
   */
  stall: () => TurnStall | null
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

/** Everything one tracker accumulates, mutated in place by the observers below. */
interface TrackerState {
  lastAction: string
  toolCalls: number
  tokens: number
  cost: number
  lastCollapsed: string | null
  /** Running calls by callID, stamped on this clock: the duration's only source. */
  readonly running: Map<string, number>
  /** What the provider has got wrong since the last step finished. */
  sinceStep: TurnStall
}

/**
 * One tracker's fixed surroundings, so the observers can live at module level.
 *
 * They were closures over `createProgressTracker`'s locals, which put the whole
 * of the observation inside one function and past `max-lines-per-function`.
 * Splitting them out needs the locals to become something nameable, and this is
 * that — the state it mutates plus the three collaborators it never changes.
 */
interface TrackerContext {
  readonly sessionId: string
  readonly log: Logger
  readonly now: () => number
  readonly transcript: TranscriptSink | undefined
  readonly state: TrackerState
}

/**
 * The line a tool activity earns, and the duration to stamp beside it — or
 * `null` for a republished start, which has already been counted and reported.
 */
const observeTool = (
  activity: Activity,
  context: TrackerContext,
): { line: string; durationMs: number | null } | null => {
  const { state } = context
  const call = String(activity.meta['call'])
  const status = String(activity.meta['status'])
  if (status === 'running') {
    // The server republishes the running state as the arguments stream in;
    // ten republishes of one call are one call, one line and one count.
    if (state.running.has(call)) return null
    state.running.set(call, context.now())
    state.toolCalls += 1
    return { line: toolLine(activity, null), durationMs: null }
  }

  const started = state.running.get(call)
  state.running.delete(call)
  const durationMs = started === undefined ? null : context.now() - started
  return { line: toolLine(activity, durationMs), durationMs }
}

/** Hands the maintainer-only detail to the transcript, when the run has one. */
const feedTranscript = (
  event: unknown,
  activity: Activity,
  durationMs: number | null,
  context: TrackerContext,
): void => {
  if (context.transcript === undefined) return
  const detail = describeDetail(event, context.sessionId)
  if (detail === null) return
  context.transcript.write({
    time: new Date(context.now()).toISOString(),
    tool: detail.tool,
    status: String(activity.meta['status']),
    detail: detail.detail,
    durationMs,
  })
}

/** Decodes one event, folds it into the running summary, and reports it. */
const observeOne = (event: unknown, context: TrackerContext): void => {
  const { log, state } = context
  const activity = describeActivity(event, context.sessionId)
  if (activity === null) return

  // Ahead of the collapse gate below: see `foldStall`.
  state.sinceStep = foldStall(state.sinceStep, activity)

  // `busy` is republished between every step; without this a hundred-step
  // turn writes a hundred identical lines and buries the tool calls.
  if (activity.collapseKey !== undefined) {
    if (activity.collapseKey === state.lastCollapsed) return
    state.lastCollapsed = activity.collapseKey
  }

  state.tokens += activity.counts?.tokens ?? 0
  state.cost += activity.counts?.cost ?? 0
  state.lastAction = activity.summary

  if (activity.kind === 'tool') {
    const observed = observeTool(activity, context)
    if (observed === null) return
    feedTranscript(event, activity, observed.durationMs, context)
    log.info({}, observed.line)
    return
  }

  if (activity.kind === 'step') {
    log.info({}, `✓ finished a step — ${state.tokens} tokens, ${state.toolCalls} tool calls so far`)
    return
  }

  if (activity.kind === 'failure') {
    // `error`, not `warn`: this is the provider saying it will not serve the
    // turn, and it is the one line that explains a run which then stops.
    log.error(activity.meta, `✗ the provider failed the turn — ${activity.summary}`)
    return
  }

  log.info({}, statusLine(activity))
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
export const createProgressTracker = (
  sessionId: string,
  log: Logger,
  options: ProgressTrackerOptions = {},
): ProgressTracker => {
  const context: TrackerContext = {
    sessionId,
    log,
    now: options.now ?? ((): number => Date.now()),
    transcript: options.transcript,
    state: {
      lastAction: 'starting',
      toolCalls: 0,
      tokens: 0,
      cost: 0,
      lastCollapsed: null,
      running: new Map(),
      sinceStep: noStall(),
    },
  }

  return {
    observe: (event): void => {
      observeOne(event, context)
    },
    snapshot: (): ProgressSnapshot => {
      const { lastAction, toolCalls, tokens, cost } = context.state
      return { lastAction, toolCalls, tokens, cost }
    },
    stall: (): TurnStall | null => reportStall(context.state.sinceStep),
  }
}
