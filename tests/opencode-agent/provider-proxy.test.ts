// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PipelineConfig } from '../../opencode-agent/src/config.js'
import type { TriggerEvent } from '../../opencode-agent/src/guardrails.js'
import { contain } from '../../opencode-agent/src/index.js'
import type { Contained } from '../../opencode-agent/src/index.js'
import { createPipelineLogger } from '../../opencode-agent/src/logger.js'
import { buildOpencodeConfig, opencodeConfigEnv } from '../../opencode-agent/src/openai-config.js'
import type { OpenAiSettings } from '../../opencode-agent/src/openai-config.js'
import { PLACEHOLDER_API_KEY, proxiedSettings, startProviderProxy } from '../../opencode-agent/src/provider-proxy.js'
import type { ProviderProxy, Serve, UpstreamFetch } from '../../opencode-agent/src/provider-proxy.js'

const KEY = 'sk-live-SUPERSECRET-0123456789'
const SETTINGS: OpenAiSettings = { apiKey: KEY, baseUrl: 'https://api.upstream.test/v1', model: 'gpt-5' }

const silentLog = {
  debug: (): void => {},
  info: (): void => {},
  warn: (): void => {},
  error: (): void => {},
}

interface Captured {
  url: string
  method: string
  authorization: string | null
  headers: Record<string, string>
}

interface Harness {
  proxy: ProviderProxy
  captured: Captured[]
  send: (path: string, init?: RequestInit) => Promise<Response>
}

type Handler = (request: Request) => Promise<Response>

/** Keeps the "did the fake `serve` hand us a handler?" narrowing out of the tests. */
/** The serialized config the SDK puts in the spawned server's environment. */
const inlinedConfig = (settings: OpenAiSettings): string =>
  opencodeConfigEnv(settings)['OPENCODE_CONFIG_CONTENT'] ?? '(absent)'

const dispatch = (handler: Handler | null): Handler =>
  handler ?? ((): Promise<Response> => Promise.reject(new Error('serve() was never called')))

/**
 * Drives the proxy's own handler directly rather than over a socket. The
 * branching lives out here so no test body carries a conditional.
 */
const harness = (upstreamBody = 'ok', status = 200): Harness => {
  const captured: Captured[] = []
  let handler: Handler | null = null

  const serve: Serve = (options) => {
    handler = options.fetch
    return { port: 9999, stop: (): void => {} }
  }
  const fetchUpstream: UpstreamFetch = (url, init) => {
    const headers = new Headers(init.headers)
    captured.push({
      url,
      method: init.method ?? 'GET',
      authorization: headers.get('authorization'),
      headers: Object.fromEntries(headers),
    })
    return Promise.resolve(new Response(upstreamBody, { status }))
  }

  const proxy = startProviderProxy(SETTINGS, silentLog, serve, fetchUpstream)
  const send = (path: string, init?: RequestInit): Promise<Response> =>
    dispatch(handler)(new Request(`http://127.0.0.1:9999${path}`, init))

  return { proxy, captured, send }
}

describe('startProviderProxy', () => {
  test('swaps the placeholder for the real credential on the way out', async () => {
    const { captured, send } = harness()

    await send('/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${PLACEHOLDER_API_KEY}`, 'content-type': 'application/json' },
      body: '{}',
    })

    expect(captured[0]?.authorization).toBe(`Bearer ${KEY}`)
    expect(captured[0]?.headers['content-type']).toBe('application/json')
  })

  test('forwards the path and query to the configured upstream', async () => {
    const { captured, send } = harness()

    await send('/chat/completions?stream=true', { method: 'POST', body: '{}' })

    expect(captured[0]?.url).toBe('https://api.upstream.test/v1/chat/completions?stream=true')
    expect(captured[0]?.method).toBe('POST')
  })

  test('does not double the slash when the base URL carries a trailing one', async () => {
    const captured: Captured[] = []
    let handler: Handler | null = null
    const serve: Serve = (options) => {
      handler = options.fetch
      return { port: 1, stop: (): void => {} }
    }
    const fetchUpstream: UpstreamFetch = (url) => {
      captured.push({ url, method: 'POST', authorization: null, headers: {} })
      return Promise.resolve(new Response('ok'))
    }

    startProviderProxy({ ...SETTINGS, baseUrl: 'https://api.upstream.test/v1//' }, silentLog, serve, fetchUpstream)
    await dispatch(handler)(new Request('http://127.0.0.1:1/chat/completions'))

    expect(captured[0]?.url).toBe('https://api.upstream.test/v1/chat/completions')
  })

  test('never forwards an inbound authorization header as given', async () => {
    // OpenCode only ever holds the placeholder, but a header that arrived from
    // anywhere else must not reach the provider either.
    const { captured, send } = harness()

    await send('/chat/completions', { method: 'POST', headers: { authorization: 'Bearer attacker-supplied' } })

    expect(captured[0]?.authorization).toBe(`Bearer ${KEY}`)
  })

  test('passes the upstream status and body straight back', async () => {
    const { send } = harness('upstream said no', 429)

    const response = await send('/chat/completions', { method: 'POST' })

    expect(response.status).toBe(429)
    expect(await response.text()).toBe('upstream said no')
  })
})

describe('proxiedSettings', () => {
  const proxy: ProviderProxy = { baseUrl: 'http://127.0.0.1:4321', close: (): Promise<void> => Promise.resolve() }

  test('points OpenCode at the proxy and hands it no real credential', () => {
    const settings = proxiedSettings(SETTINGS, proxy)

    expect(settings.baseUrl).toBe('http://127.0.0.1:4321')
    expect(settings.apiKey).toBe(PLACEHOLDER_API_KEY)
    expect(settings.model).toBe('gpt-5')
  })

  test('keeps the key out of the config the SDK puts in the child environment', () => {
    // `createOpencodeServer` spawns `opencode serve` with the serialized config
    // in OPENCODE_CONFIG_CONTENT, so every process the model starts with `bash`
    // inherits it. Verified against /proc/<pid>/environ of a real spawned
    // server: before this, the key was there.
    const inlined = inlinedConfig(proxiedSettings(SETTINGS, proxy))

    expect(inlined).not.toContain(KEY)
    expect(inlined).toContain(PLACEHOLDER_API_KEY)
  })

  test('the un-proxied config would have leaked it, which is why this exists', () => {
    expect(JSON.stringify(buildOpencodeConfig(SETTINGS))).toContain(KEY)
  })
})

describe('contain', () => {
  const config = (): PipelineConfig => ({
    repoRoot: '/repo',
    owner: 'acme',
    repo: 'widgets',
    githubToken: 'ghp_0123456789abcdefghij',
    selfLogin: 'agent-bot',
    selfWorkflowName: 'OpenCode Issue Agent',
    openai: SETTINGS,
    commitAuthorName: 'agent',
    commitAuthorEmail: 'agent@example.com',
    checkCommand: 'bun test',
    reviewCommand: null,
    checks: [],
    reviewMaxRounds: 2,
    reviewPoolSize: 1,
    agentTimeoutMs: 1000,
    ciFixMaxRounds: 2,
    maxCiAttempts: 2,
    maxAttempts: 3,
    diffLimits: { maxFiles: 100, maxLines: 20_000 },
    gitRemoteBase: 'https://github.com/',
    skillRoots: [],
  })

  const event: TriggerEvent = {
    kind: 'issue',
    eventName: 'issues',
    action: 'opened',
    senderLogin: 'maintainer',
    senderType: 'User',
    authorAssociation: 'OWNER',
    issueNumber: 42,
    issueTitle: 't',
    issueBody: 'b',
    isPullRequest: false,
    commentBody: null,
    repositoryOwner: 'acme',
    defaultBranch: 'master',
  }

  const contained = (): Contained =>
    contain({
      config: config(),
      event,
      log: silentLog,
      run: () => Promise.resolve({ command: '', exitCode: 0, stdout: '', stderr: '' }),
      options: { argv: [], env: {} },
    })

  test('the pipeline actually applies it, not just the proxy module', async () => {
    // The adapter can be perfect and still never be wired in: a mutation
    // replacing the contained config with the raw one killed no test until this
    // existed. Same shape as the outbound-redaction gap in S3-3.
    const run = contained()

    expect(run.deps.config.openai.apiKey).toBe(PLACEHOLDER_API_KEY)
    expect(run.deps.config.openai.baseUrl).toStartWith('http://127.0.0.1:')
    await run.proxy.close()
  })

  test('the logger it builds knows the credentials it must never print', () => {
    // The wiring, not the logger: dropping `secrets` from an inline
    // `createLogger` call killed no test, because a call site is not something
    // a test can hold. `createPipelineLogger` is.
    const lines: string[] = []
    const log = createPipelineLogger('debug', config(), (line) => void lines.push(line))

    log.error({ issue: 42 }, `provider rejected the call for ${KEY}`)

    expect(lines[0]).not.toContain(KEY)
    expect(lines[0]).toContain('[redacted]')
  })

  test('keeps the real credentials for the guards that need them', async () => {
    // Scrubbing, outbound redaction and the diff guard all protect the *value*,
    // so containment must not hide it from them.
    const run = contained()

    expect(JSON.stringify(run.deps.config)).not.toContain(KEY)
    await run.proxy.close()
  })
})
