// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { withDeadline } from './deadline.js'
import { openCodeError } from './errors.js'
import { followEvents } from './event-follower.js'
import type { EventFollower } from './event-follower.js'
import type { Logger } from './logger.js'
import { modelRef } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
import { connectSdk } from './opencode-connect.js'
import { createProgressTracker } from './progress.js'
import type { ProgressTracker, TranscriptSink } from './progress.js'
import { buildBody, decodeAbort, decodeReply, parseModelRef } from './sdk-contract.js'
import type { SessionUsage } from './sdk-contract.js'
import { requireAnswer, runTurn } from './turn-run.js'
import type { TurnBounds, TurnConnection } from './turn-run.js'

export type { ModelRef, SdkPromptBody } from './sdk-contract.js'
export { parseModelRef } from './sdk-contract.js'
import { errorMessage } from './types.js'

export interface AgentPromptRequest {
  prompt: string
  system?: string
  /** OpenCode agent profile (`build`, `plan`, …). */
  agent?: string
  /** Per-call tool allow/deny overrides passed straight through to the SDK. */
  tools?: Record<string, boolean>
}

export interface AgentPromptResult {
  text: string
  sessionId: string
}

/** A live OpenCode session bound to one workspace directory. */
export interface OpenCodeAgent {
  readonly sessionId: string
  prompt(request: AgentPromptRequest): Promise<AgentPromptResult>
  /**
   * Tokens this session has consumed. Zero when the server cannot say — a
   * budget is a guardrail on the work, not part of it, so a shape it fails to
   * recognise must not turn every phase into a failure.
   */
  tokensUsed(): Promise<number>
  /**
   * Stops whatever the model is running, and says whether the server took it.
   *
   * The one boundary in this pipeline that is best-effort **and** reports.
   * Measured against a live server: an abort kills the tool child and leaves the
   * server up, while `close()` — a bare SIGTERM to one pid on POSIX — kills the
   * server and leaves the tool child running, reparented to init. So this is the
   * stop and `close()` is the leak, and the two are not each other's fallback.
   *
   * A refused abort must not become the run's failure — the stop it belongs to is
   * already out of time and cannot afford a second thing to go wrong — but unlike
   * the feedback channels it cannot swallow the answer either: the salvage stages
   * a working tree, and staging one whose writer may still be running is the only
   * thing that path must never do. Hence `boolean` rather than `void`.
   */
  abort(): Promise<boolean>
  close(): Promise<void>
}

/**
 * Minimal slice of the SDK surface the adapter drives.
 *
 * The two calls a *turn* makes — `sendPrompt` and `alive` — are inherited rather
 * than restated: they are the contract `turn-run.ts` needs, and a second
 * declaration here is a second thing to keep in step.
 */
export interface OpenCodeConnection extends TurnConnection {
  createSession(title: string): Promise<string>
  /**
   * The server's event stream, used only to report progress.
   *
   * Required rather than optional, though nothing breaks without it: an
   * optional method is one a connection can silently fail to provide, and this
   * workspace's recurring bug is a feature that is wired everywhere except the
   * one place that matters. A connection with nothing to say returns an empty
   * iterable and says so.
   */
  events(): Promise<AsyncIterable<unknown>>
  /** What this session has spent so far, as the server accounts for it. */
  usage(sessionId: string): Promise<SessionUsage | null>
  /**
   * Asks the server to stop what this session is running, envelope and all.
   *
   * Required rather than optional, for the reason `events` is: an optional method
   * is one a connection can silently fail to provide, and a stop nobody wired is
   * the failure this whole finding is about.
   */
  abort(sessionId: string): Promise<unknown>
  close(): Promise<void>
}

export interface OpenCodeAgentOptions extends TurnBounds {
  directory: string
  /** The single OpenAI-compatible endpoint this pipeline talks to. */
  openai: OpenAiSettings
  sessionTitle: string
  /**
   * The encrypted debug transcript, when the run has one.
   *
   * The adapter is the only layer that sees the event stream, so the
   * maintainer-only detail has to leave from here or never leave at all.
   * Absent on a keyless run, which is the ordinary case.
   */
  transcript?: TranscriptSink
  /** Injection seam for tests. Defaults to the real SDK server + client. */
  connect?: () => Promise<OpenCodeConnection>
}

/**
 * Boots a headless OpenCode server in-process and opens one session against the
 * checked-out workspace. The server binds loopback only and dies with the job,
 * which is exactly the lifetime an ephemeral Actions runner gives us.
 */
export const createOpenCodeAgent = async (options: OpenCodeAgentOptions): Promise<OpenCodeAgent> => {
  const model = parseModelRef(modelRef(options.openai))
  const connect = options.connect ?? ((): Promise<OpenCodeConnection> => connectSdk(options.directory, options.openai))
  const connection = await connect()

  let sessionId: string
  try {
    sessionId = await connection.createSession(options.sessionTitle)
  } catch (error) {
    await connection.close()
    throw openCodeError(`Failed to open OpenCode session: ${errorMessage(error)}`)
  }

  const { tracker, shutdown } = startReporting(connection, sessionId, options.log, options.transcript)

  return {
    sessionId,
    prompt: async (request) => {
      const reply = await runTurn(connection, sessionId, buildBody(model, request), options, tracker)
      const text = decodeReply(reply)
      // Here rather than inside `runTurn`, which never sees the decoded reply:
      // the emptiness and the stall only mean anything together.
      requireAnswer(text, tracker, options)
      return { text, sessionId }
    },
    tokensUsed: async (): Promise<number> => {
      const usage = await connection.usage(sessionId).catch(() => null)
      if (usage === null) {
        options.log.warn({ sessionId }, 'The server did not report session usage; the token budget cannot see this run')
        return 0
      }

      options.log.debug({ sessionId, tokens: usage.tokens, cost: usage.cost }, 'Session usage')
      return usage.tokens
    },
    abort: () => abortSession(connection, sessionId, options.log),
    close: async (): Promise<void> => {
      // Reporting first. Closing the server does not, by itself, end the stream
      // — see the `sseMaxRetryAttempts` note above — so teardown has to say stop
      // rather than wait for the events to run out.
      await shutdown()
      await connection.close()
    },
  }
}

/**
 * Asks the server to stop, and turns every way that can go wrong into an answer.
 *
 * Three cases collapse to `false`, and each is a real one: the server declines
 * (`{ data: false }`), the call never lands (a socket refused mid-teardown), or
 * the envelope is a shape this pin does not know — which `decodeAbort` throws
 * about on purpose, so a moved payload is named in the log rather than degrading
 * to a permanent silent "the abort did not take".
 *
 * `warn` and not `error`, because nothing has failed: the caller's own next step
 * is to say so on the issue.
 */
const abortSession = async (connection: OpenCodeConnection, sessionId: string, log: Logger): Promise<boolean> => {
  try {
    const accepted = decodeAbort(await connection.abort(sessionId))
    if (accepted) log.info({ sessionId }, 'Aborted the model turn; the tool it was running is stopped')
    else log.warn({ sessionId }, 'The server did not accept the abort; the model may still be running')
    return accepted
  } catch (error) {
    log.warn({ sessionId, error: errorMessage(error) }, 'Could not abort the model turn')
    return false
  }
}

/** How long teardown waits for reporting to wind down before giving up on it. */
const SHUTDOWN_GRACE_MS = 5_000

/**
 * Starts draining the event stream into a tracker, and hands back the off switch.
 *
 * Detached on purpose: the stream runs for the life of the server, so awaiting
 * it inline would never return. Nothing it does can reject, and a failed
 * subscription costs the run its progress log and nothing else — this is
 * reporting, and reporting must not be able to fail the work it reports on.
 *
 * `shutdown` stops the drain and then waits for it, so a `close()` that races a
 * still-arriving event does not cut it off mid-observation. Bounded, because
 * the one thing worse than losing a progress line is teardown hanging on the
 * reporting it is trying to shut down.
 */
const startReporting = (
  connection: OpenCodeConnection,
  sessionId: string,
  log: Logger,
  transcript?: TranscriptSink,
): { tracker: ProgressTracker; shutdown: () => Promise<void> } => {
  const tracker = createProgressTracker(sessionId, log, { transcript })
  let follower: EventFollower | null = null
  let stopped = false

  const finished = connection
    .events()
    .then(async (stream) => {
      follower = followEvents(stream, tracker)
      // `shutdown()` can win the race against a slow subscription.
      if (stopped) follower.stop()
      await follower.done
    })
    .catch((error: unknown) => {
      log.warn({ error: errorMessage(error) }, 'No progress events; the run is unaffected')
    })

  return {
    tracker,
    shutdown: async (): Promise<void> => {
      stopped = true
      follower?.stop()
      await withDeadline(finished, SHUTDOWN_GRACE_MS, () => new Error('unused')).catch(() => {
        log.debug({}, 'Progress reporting did not wind down in time; continuing teardown')
      })
    },
  }
}
