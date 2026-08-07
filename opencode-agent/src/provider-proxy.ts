// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Logger } from './logger.js'
import type { OpenAiSettings } from './openai-config.js'

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

export type Serve = (options: ServeOptions) => ProxyListener

/**
 * The slice of `fetch` the proxy uses. Narrower than the runtime's global type,
 * which carries Bun-only members a test double has no reason to supply.
 */
export type UpstreamFetch = (url: string, init: RequestInit) => Promise<Response>

const defaultServe: Serve = (options) => {
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: options.fetch })
  // Bun types `port` as optional; a bound TCP listener always has one.
  return { port: server.port ?? 0, stop: (): void => void server.stop(true) }
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
): ProviderProxy => {
  const upstream = settings.baseUrl.replace(/\/+$/u, '')

  const listener = serve({
    fetch: async (request): Promise<Response> => {
      const target = `${upstream}${new URL(request.url).pathname}${new URL(request.url).search}`
      const response = await fetchUpstream(target, {
        method: request.method,
        headers: forwardHeaders(request.headers, settings.apiKey),
        body: request.body,
        // Streamed request bodies need this; the model endpoint is a POST.
        ...{ duplex: 'half' },
      })
      // The body is passed through unread, so a streamed completion stays
      // streamed rather than being buffered into memory.
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
