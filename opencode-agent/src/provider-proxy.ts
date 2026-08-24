// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Logger } from './logger.js'
import type { OpenAiSettings } from './openai-config.js'
import { errorMessage } from './types.js'

/**
 * Placeholder the model endpoint is configured with.
 *
 * Deliberately not a plausible key: it exists to be *seen* in a leaked config,
 * so anyone who finds it knows immediately that it is not the credential.
 */
export const PLACEHOLDER_API_KEY = 'unused-see-provider-proxy'

export interface ProviderProxy {
  /** Loopback URL to configure OpenCode with, in place of the real endpoint. */
  baseUrl: string
  close: () => Promise<void>
}

/** The slice of `Bun.serve` this module needs, so tests can supply their own. */
export interface ProxyListener {
  port: number
  stop: () => void
}

export interface ServeOptions {
  fetch: (request: Request) => Promise<Response>
}

/** The options {@link defaultServe} hands the runtime. */
export interface BunServeOptions extends ServeOptions {
  port: number
  hostname: string
  idleTimeout: number
}

/**
 * The slice of the runtime's `Bun.serve` {@link defaultServe} calls.
 *
 * Injected for the same reason {@link Serve} is, and for one more: a started
 * server does not report its `idleTimeout` back, so without this seam the only
 * proof of that value is a test that spends eleven real seconds watching a
 * stream survive — and it is the value that broke the pipeline.
 */
export type BunServe = (options: BunServeOptions) => {
  port?: number
  stop: (closeActiveConnections: boolean) => void
}

export type Serve = (options: ServeOptions) => ProxyListener

/**
 * The slice of `fetch` the proxy uses. Narrower than the runtime's global type,
 * which carries Bun-only members a test double has no reason to supply.
 */
export type UpstreamFetch = (url: string, init: RequestInit) => Promise<Response>

/** Injected so a backoff test does not spend real seconds waiting. */
export type Wait = (ms: number) => Promise<void>

/**
 * Attempts per upstream call, including the first.
 *
 * Small on purpose. This retries a rate limit or a bad gateway, not a broken
 * configuration: a wrong key answers 401 and is not retried at all, and a
 * provider that is genuinely down should fail the phase in seconds rather than
 * spend the job's budget rediscovering that.
 */
const MAX_ATTEMPTS = 3

/** First backoff; each further attempt doubles it. */
const BASE_BACKOFF_MS = 1000

/** Cap on a `Retry-After` the provider asks for, so it cannot park the job. */
const MAX_BACKOFF_MS = 20_000

/**
 * Statuses worth trying again.
 *
 * By status, not by guessing at an error shape. 408, 429 and 5xx are the ones
 * where the request did not get a considered answer; everything else — 400, 401,
 * 404, 422 — is a statement about the request, and repeating it changes nothing.
 * 501 is deliberately excluded for the same reason.
 */
const isTransient = (status: number): boolean =>
  status === 408 || status === 429 || (status >= 500 && status !== 501 && status < 600)

/**
 * How long to wait before attempt `n`, honouring `Retry-After` when the provider
 * sent one — it knows when its window resets and the exponential guess does not.
 */
export const backoffFor = (attempt: number, retryAfter: string | null): number => {
  const seconds = retryAfter === null ? Number.NaN : Number.parseInt(retryAfter, 10)
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, MAX_BACKOFF_MS)
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS)
}

const defaultWait: Wait = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms)
  })

export const defaultServe = (options: ServeOptions, bunServe: BunServe = Bun.serve): ProxyListener => {
  const server = bunServe({
    port: 0,
    hostname: '127.0.0.1',
    // `0` disables Bun's idle bound, which defaults to ten seconds and counts a
    // *streamed* response as idle whenever no byte moves. The body forwarded
    // below is the model's completion stream, and a reasoning turn goes quiet
    // for longer than that between chunks routinely — so the default cut the
    // socket mid-completion, which reads downstream as the provider failing:
    // OpenCode retries, meets the same pause, and the turn stalls out having
    // finished no step. The turn is already bounded by `AGENT_TIMEOUT_MS` and
    // `AGENT_STALL_TIMEOUT_MS`, so a third and far fiercer bound buried in the
    // transport can only fight them — and Bun caps the knob at 255 seconds,
    // which a long turn would still outlast.
    idleTimeout: 0,
    fetch: options.fetch,
  })
  // Bun types `port` as optional; a bound TCP listener always has one.
  return {
    port: server.port ?? 0,
    stop: (): void => {
      server.stop(true)
    },
  }
}

/** Hop-by-hop and length headers a proxy must not copy verbatim. */
const DROPPED_REQUEST_HEADERS: ReadonlySet<string> = new Set(['host', 'connection', 'content-length'])

const forwardHeaders = (incoming: Headers, apiKey: string): Headers => {
  const headers = new Headers()
  for (const [name, value] of incoming) {
    if (!DROPPED_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value)
  }
  // Unconditional, and after the copy: this overwrites whatever arrived, so an
  // inbound `authorization` never survives. Listing it in the dropped set too
  // would read as a second defence while being unreachable — the kind of dead
  // guard that no test can hold in place.
  headers.set('authorization', `Bearer ${apiKey}`)
  return headers
}

interface Forward {
  target: string
  init: RequestInit
  fetchUpstream: UpstreamFetch
  wait: Wait
  log: Logger
}

/**
 * Reads the request body up front so a retry has something to send again.
 *
 * The old handler forwarded `request.body` as a stream, which is cheaper and
 * cannot be replayed — a stream is consumed by the attempt that failed. Model
 * requests are a prompt and its history, already fully in memory in the process
 * that sent them, so buffering costs nothing that was not already spent. The
 * *response* is still streamed.
 */
const bodyOf = async (request: Request): Promise<{ body?: ArrayBuffer }> => {
  if (request.method === 'GET' || request.method === 'HEAD') return {}
  return { body: await request.arrayBuffer() }
}

/**
 * One attempt, reporting a transport failure as a synthetic 502.
 *
 * So that "should this be retried?" is decided in one place, on a status, rather
 * than once on a status and again on whatever shape the runtime's fetch throws.
 * The real message goes to the log, which redacts; the body the model may end up
 * seeing does not, so it says nothing specific.
 */
const attemptOnce = async (forward: Forward): Promise<Response> => {
  try {
    return await forward.fetchUpstream(forward.target, forward.init)
  } catch (error) {
    forward.log.warn({ error: errorMessage(error) }, 'Provider call failed before any reply')
    return new Response('proxy: the provider could not be reached', { status: 502 })
  }
}

/**
 * Retries a transient upstream failure, up to {@link MAX_ATTEMPTS}.
 *
 * Here rather than in the adapter for three reasons. This is the one place that
 * sees an actual HTTP status, so the retry decision needs no guess about how the
 * SDK reports an error. It is shared with the `review-loop/` workspace's
 * `opencode run` subprocesses, which are configured against this proxy and which
 * no adapter-level retry could reach. And it is the only layer where retrying is
 * safe by construction: nothing has been forwarded to the caller yet — the
 * status arrives before the body — so there is no half-streamed completion to
 * replay.
 *
 * Tail recursion rather than a loop: the repo forbids `await` in a loop body.
 */
const forwardWithRetry = async (forward: Forward, attempt = 1): Promise<Response> => {
  const response = await attemptOnce(forward)
  if (!isTransient(response.status) || attempt >= MAX_ATTEMPTS) return response

  const delayMs = backoffFor(attempt, response.headers.get('retry-after'))
  forward.log.warn({ status: response.status, attempt, delayMs }, 'Provider call failed transiently; retrying')

  // The discarded reply still holds a socket until something drains it.
  await response.body?.cancel()
  await forward.wait(delayMs)
  return forwardWithRetry(forward, attempt + 1)
}

/**
 * Runs a loopback proxy that holds the provider key so nothing downstream has to.
 *
 * `createOpencodeServer` spawns `opencode serve` with `OPENCODE_CONFIG_CONTENT`
 * set to the serialized config — and the config is where the provider key lives,
 * so the key lands in the child's environment. Every process the model starts
 * with `bash` inherits it from there, which makes `echo $OPENCODE_CONFIG_CONTENT`
 * a complete credential disclosure. Scrubbing `process.env` cannot help: the SDK
 * sets that variable on the child, after the scrub. Verified by reading
 * `/proc/<pid>/environ` of a real spawned server.
 *
 * So OpenCode is configured with a placeholder key and a loopback base URL, and
 * this proxy swaps in the real `Authorization` on the way out. The key stays in
 * the parent process, which the model has no handle on.
 *
 * Loopback-bound and ephemeral-ported: it is reachable only from this machine,
 * and it dies with the job. It is not an authentication boundary — anything that
 * can already run code here can call it — but it removes the credential from the
 * places an *injected prompt* can read.
 */
export const startProviderProxy = (
  settings: OpenAiSettings,
  log: Logger,
  serve: Serve = defaultServe,
  fetchUpstream: UpstreamFetch = globalThis.fetch,
  wait: Wait = defaultWait,
): ProviderProxy => {
  const upstream = settings.baseUrl.replace(/\/+$/u, '')

  const listener = serve({
    fetch: async (request): Promise<Response> => {
      const url = new URL(request.url)
      const response = await forwardWithRetry({
        target: `${upstream}${url.pathname}${url.search}`,
        init: {
          method: request.method,
          headers: forwardHeaders(request.headers, settings.apiKey),
          ...(await bodyOf(request)),
        },
        fetchUpstream,
        wait,
        log,
      })
      // The *response* body is passed through unread, so a streamed completion
      // stays streamed rather than being buffered into memory.
      return new Response(response.body, { status: response.status, headers: response.headers })
    },
  })

  log.debug({ port: listener.port }, 'Provider proxy listening')

  return {
    baseUrl: `http://127.0.0.1:${listener.port}`,
    close: (): Promise<void> => {
      listener.stop()
      return Promise.resolve()
    },
  }
}

/** The settings OpenCode is configured with: the proxy, and no real credential. */
export const proxiedSettings = (settings: OpenAiSettings, proxy: ProviderProxy): OpenAiSettings => ({
  ...settings,
  baseUrl: proxy.baseUrl,
  apiKey: PLACEHOLDER_API_KEY,
})
