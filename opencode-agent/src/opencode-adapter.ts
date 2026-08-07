// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createServer } from 'node:net'

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'

import { withDeadline } from './deadline.js'
import { openCodeError } from './errors.js'
import type { Logger } from './logger.js'
import { buildOpencodeConfig, modelRef } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
import { createProgressTracker, followEvents, withHeartbeat } from './progress.js'
import type { EventFollower, ProgressTracker } from './progress.js'
import { decodeReply, decodeSessionId } from './sdk-contract.js'
import { errorMessage } from './types.js'

/** `providerID/modelID`, e.g. `openai/gpt-5`. */
export interface ModelRef {
  providerID: string
  modelID: string
}

/**
 * Splits `provider/model` into the shape the SDK expects. Model ids may contain
 * slashes themselves (`openrouter/anthropic/claude-3.5`), so only the first
 * segment is treated as the provider.
 */
export const parseModelRef = (raw: string): ModelRef => {
  const separator = raw.indexOf('/')
  if (separator <= 0 || separator === raw.length - 1) {
    throw openCodeError(`Model must be "provider/model", got "${raw}"`)
  }
  return { providerID: raw.slice(0, separator), modelID: raw.slice(separator + 1) }
}

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
  close(): Promise<void>
}

export interface SdkPromptBody {
  model: ModelRef
  agent?: string
  system?: string
  tools?: Record<string, boolean>
  parts: Array<{ type: 'text'; text: string }>
}

/** Minimal slice of the SDK surface the adapter drives. */
export interface OpenCodeConnection {
  createSession(title: string): Promise<string>
  sendPrompt(sessionId: string, body: SdkPromptBody): Promise<unknown>
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
  close(): Promise<void>
}

export interface OpenCodeAgentOptions {
  directory: string
  /** The single OpenAI-compatible endpoint this pipeline talks to. */
  openai: OpenAiSettings
  sessionTitle: string
  /**
   * Upper bound on one model turn, from `AGENT_TIMEOUT_MS`. Omitted means
   * unbounded, which only a caller with nothing to bound should want — config
   * range-checks that variable to at least a second.
   *
   * Every subprocess this pipeline drives already had one — the check runner and
   * the review loop both pass it to `runCommand` — and the in-process session,
   * the one turn that can run for twenty minutes, was the only path without.
   */
  timeoutMs?: number
  /** Where progress goes. The adapter is the only thing that can see it. */
  log: Logger
  /** Heartbeat period while a turn is outstanding. `0` disables it. */
  heartbeatMs?: number
  /** Injection seam for tests. Defaults to the real SDK server + client. */
  connect?: () => Promise<OpenCodeConnection>
}

/**
 * How often a turn says it is still alive.
 *
 * A minute is short enough that a stalled job is obvious within one screen of
 * log, and long enough that a twenty-minute implement phase adds twenty lines
 * rather than swamping the tool calls that carry the real information.
 */
const DEFAULT_HEARTBEAT_MS = 60_000

const buildBody = (model: ModelRef, request: AgentPromptRequest): SdkPromptBody => ({
  model,
  parts: [{ type: 'text', text: request.prompt }],
  ...(request.agent === undefined ? {} : { agent: request.agent }),
  ...(request.system === undefined ? {} : { system: request.system }),
  ...(request.tools === undefined ? {} : { tools: request.tools }),
})

/**
 * Reserves a free TCP port.
 *
 * `createOpencodeServer` passes its `port` straight to `opencode serve`, and
 * port `0` there does *not* mean "pick an ephemeral one" — the server was
 * observed booting on its 4096 default instead, so two agent processes on one
 * host would collide. Binding a listener and reading back the assigned port
 * gets a real free one. The window between closing this and the server binding
 * is a race in theory; in practice it beats a fixed port that is guaranteed to
 * clash.
 */
const reservePort = (): Promise<number> => {
  const probe = createServer()
  return new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => {
        if (port === 0) reject(new Error('Could not reserve a port for the OpenCode server'))
        else resolve(port)
      })
    })
  })
}

/** The SDK's own default is 5s, which a cold runner with a large repo can miss. */
const SERVER_BOOT_TIMEOUT_MS = 60_000

const connectSdk = async (directory: string, openai: OpenAiSettings): Promise<OpenCodeConnection> => {
  // The provider, endpoint and model are pinned in the server's own config, so
  // the session cannot fall back to whatever credentials happen to be in env.
  // The SDK delivers this to `opencode serve` through OPENCODE_CONFIG_CONTENT —
  // the same channel the review-loop subprocesses use.
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port: await reservePort(),
    config: buildOpencodeConfig(openai),
    timeout: SERVER_BOOT_TIMEOUT_MS,
  })
  const client = createOpencodeClient({ baseUrl: server.url, directory })

  return {
    createSession: async (title) => {
      const created = await client.session.create({ body: { title }, query: { directory } })
      return decodeSessionId(created)
    },
    sendPrompt: (sessionId, body) => client.session.prompt({ path: { id: sessionId }, body, query: { directory } }),
    // `/event` is a server-sent-event stream; the generated client hands back
    // the parsed events as an async generator.
    //
    // `sseMaxRetryAttempts: 0` is load-bearing. The client's default is to
    // reconnect for ever with no cap, so when `close()` kills the server the
    // stream does not end — it starts retrying a socket that will never come
    // back. Verified against a real server: without this the generator was
    // still open eight seconds after the server was closed, and a teardown that
    // waited on it hung the job until its own timeout.
    events: async () => (await client.event.subscribe({ sseMaxRetryAttempts: 0 })).stream,
    close: (): Promise<void> => {
      server.close()
      return Promise.resolve()
    },
  }
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

  const { tracker, shutdown } = startReporting(connection, sessionId, options.log)

  return {
    sessionId,
    prompt: async (request) => {
      const reply = await bounded(connection.sendPrompt(sessionId, buildBody(model, request)), options, tracker)
      return { text: decodeReply(reply), sessionId }
    },
    close: async (): Promise<void> => {
      // Reporting first. Closing the server does not, by itself, end the stream
      // — see the `sseMaxRetryAttempts` note above — so teardown has to say stop
      // rather than wait for the events to run out.
      await shutdown()
      await connection.close()
    },
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
): { tracker: ProgressTracker; shutdown: () => Promise<void> } => {
  const tracker = createProgressTracker(sessionId, log)
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

/**
 * Wraps one turn in both of its bounds.
 *
 * Heartbeat outside the deadline, never inside it: a deadline that fires leaves
 * the underlying call pending, so an inner heartbeat's cleanup would never run
 * and its interval would hold the process open past the end of the job.
 */
const bounded = (work: Promise<unknown>, options: OpenCodeAgentOptions, tracker: ProgressTracker): Promise<unknown> =>
  withHeartbeat(
    withDeadline(work, options.timeoutMs ?? 0, (elapsed) =>
      openCodeError(
        `The model did not answer within ${elapsed}ms (AGENT_TIMEOUT_MS). Raise it, or narrow the phase's work.`,
      ),
    ),
    { everyMs: options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS, log: options.log, snapshot: tracker.snapshot },
  )
