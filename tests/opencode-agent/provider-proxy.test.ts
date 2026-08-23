// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { PipelineConfig } from '../../opencode-agent/src/config.js'
import { createOctokitApi } from '../../opencode-agent/src/github.js'
import type { GitHubApi } from '../../opencode-agent/src/github.js'
import { contain } from '../../opencode-agent/src/index.js'
import type { Contained } from '../../opencode-agent/src/index.js'
import { createPipelineLogger } from '../../opencode-agent/src/logger.js'
import { buildOpencodeConfig, opencodeConfigEnv } from '../../opencode-agent/src/openai-config.js'
import type { OpenAiSettings } from '../../opencode-agent/src/openai-config.js'
import type { OpenCodeAgentOptions } from '../../opencode-agent/src/opencode-adapter.js'
import {
  backoffFor,
  PLACEHOLDER_API_KEY,
  proxiedSettings,
  startProviderProxy,
} from '../../opencode-agent/src/provider-proxy.js'
import type { ProviderProxy, Serve, UpstreamFetch } from '../../opencode-agent/src/provider-proxy.js'
import type { TriggerEvent } from '../../opencode-agent/src/trigger-events.js'

const KEY = 'sk-live-SUPERSECRET-0123456789'
const SETTINGS: OpenAiSettings = {
  apiKey: KEY,
  baseUrl: 'https://api.upstream.test/v1',
  model: 'gpt-5',
  provider: 'openai',
}

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
  body?: BodyInit | null
}

interface Harness {
  proxy: ProviderProxy
  captured: Captured[]
  /** Every backoff the proxy asked for, in order. Nothing actually sleeps. */
  waits: number[]
  send: (path: string, init?: RequestInit) => Promise<Response>
}

type Handler = (request: Request) => Promise<Response>

/** One scripted upstream reply. */
interface Upstream {
  body?: string
  status?: number
  headers?: Record<string, string>
  /** Set when this attempt should fail in transport rather than answer. */
  throws?: string
}

/** The serialized config the SDK puts in the spawned server's environment. */
const inlinedConfig = (settings: OpenAiSettings): string =>
  opencodeConfigEnv(settings)['OPENCODE_CONFIG_CONTENT'] ?? '(absent)'

/** Keeps the "did the fake `serve` hand us a handler?" narrowing out of the tests. */
const dispatch = (handler: Handler | null): Handler =>
  handler ?? ((): Promise<Response> => Promise.reject(new Error('serve() was never called')))

/** The reply for attempt `n`, repeating the last one once the script runs out. */
const replyFor = (script: readonly Upstream[], attempt: number): Upstream =>
  script[Math.min(attempt, script.length - 1)] ?? {}

/** Keeps the "was anything captured?" narrowing out of the test bodies. */
const headerNames = (call: Captured | undefined): string[] => Object.keys(call?.headers ?? {})

/**
 * The bound the session would hand the turn it is about to take.
 *
 * A function rather than a number on the options, so a test has to *ask* — which is
 * the property being asserted: one job runs a turn per plan step, and each of them
 * needs a bound sized against the clock as it reads then.
 */
const asked = (options: OpenCodeAgentOptions | undefined): number | undefined => {
  const bound = options?.timeoutMs
  return typeof bound === 'function' ? bound() : bound
}

const answer = (reply: Upstream): Promise<Response> => {
  if (reply.throws !== undefined) return Promise.reject(new Error(reply.throws))
  return Promise.resolve(new Response(reply.body ?? 'ok', { status: reply.status ?? 200, headers: reply.headers }))
}

/**
 * Drives the proxy's own handler directly rather than over a socket, against a
 * scripted sequence of upstream replies. The branching lives out here so no test
 * body carries a conditional.
 */
const harness = (script: readonly Upstream[] = [{}]): Harness => {
  const captured: Captured[] = []
  const waits: number[] = []
  let handler: Handler | null = null

  const serve: Serve = (options) => {
    handler = options.fetch
    return { port: 9999, stop: (): void => {} }
  }
  const fetchUpstream: UpstreamFetch = (url, init) => {
    const headers = new Headers(init.headers)
    const attempt = captured.length
    captured.push({
      url,
      method: init.method ?? 'GET',
      authorization: headers.get('authorization'),
      headers: Object.fromEntries(headers),
      body: init.body,
    })
    return answer(replyFor(script, attempt))
  }

  const proxy = startProviderProxy(SETTINGS, silentLog, serve, fetchUpstream, (ms) => {
    waits.push(ms)
    return Promise.resolve()
  })
  const send = (path: string, init?: RequestInit): Promise<Response> =>
    dispatch(handler)(new Request(`http://127.0.0.1:9999${path}`, init))

  return { proxy, captured, waits, send }
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

  test('drops every hop-by-hop header, whatever case it arrives in', async () => {
    // `Host` would address the proxy rather than the provider, and the lengths
    // describe a body this proxy re-sends itself.
    const { captured, send } = harness()

    await send('/chat/completions', {
      method: 'POST',
      headers: { Host: '127.0.0.1:9999', Connection: 'keep-alive', 'Content-Length': '2' },
      body: '{}',
    })

    expect(headerNames(captured[0])).toEqual(['authorization'])
  })

  test('never forwards an inbound authorization header as given', async () => {
    // OpenCode only ever holds the placeholder, but a header that arrived from
    // anywhere else must not reach the provider either.
    const { captured, send } = harness()

    await send('/chat/completions', { method: 'POST', headers: { authorization: 'Bearer attacker-supplied' } })

    expect(captured[0]?.authorization).toBe(`Bearer ${KEY}`)
  })

  test('passes the upstream status and body straight back', async () => {
    const { send } = harness([{ body: 'that model does not exist', status: 404 }])

    const response = await send('/chat/completions', { method: 'POST' })

    expect(response.status).toBe(404)
    expect(await response.text()).toBe('that model does not exist')
  })

  test('forwards the request body, which a retry has to be able to send again', async () => {
    // It used to be piped through as a stream, which is consumed by the attempt
    // that failed and cannot be replayed.
    const { captured, send } = harness([{ status: 500 }, {}])

    await send('/chat/completions', { method: 'POST', body: '{"model":"gpt-5"}' })

    const bodies = await Promise.all(captured.map((call) => new Response(call.body).text()))
    expect(bodies).toEqual(['{"model":"gpt-5"}', '{"model":"gpt-5"}'])
  })
})

describe('retrying a transient provider failure', () => {
  test('retries a 429 and returns the reply that succeeded', async () => {
    const { captured, send, waits } = harness([{ status: 429 }, { body: 'second time lucky' }])

    const response = await send('/chat/completions', { method: 'POST' })

    expect(response.status).toBe(200)
    expect(await response.text()).toBe('second time lucky')
    expect(captured).toHaveLength(2)
    expect(waits).toEqual([1000])
  })

  test('retries a fetch that fails in transport, not only a bad status', async () => {
    const { captured, send } = harness([{ throws: 'ECONNRESET' }, { body: 'recovered' }])

    expect(await (await send('/chat/completions', { method: 'POST' })).text()).toBe('recovered')
    expect(captured).toHaveLength(2)
  })

  test('reports an unreachable provider as a 502 rather than throwing at the socket', async () => {
    const { send } = harness([{ throws: 'ECONNRESET' }])

    const response = await send('/chat/completions', { method: 'POST' })

    expect(response.status).toBe(502)
    // The transport message goes to the log, which redacts; this body does not,
    // so it says the shape of the problem and nothing specific.
    const body = await response.text()
    expect(body).toContain('provider could not be reached')
    expect(body).not.toContain('ECONNRESET')
  })

  test('gives up after three attempts and returns the last failure', async () => {
    // A provider that is genuinely down must fail the phase in seconds, not
    // spend the job's budget rediscovering that.
    const { captured, send, waits } = harness([{ body: 'still rate limited', status: 429 }])

    const response = await send('/chat/completions', { method: 'POST' })

    expect(response.status).toBe(429)
    expect(await response.text()).toBe('still rate limited')
    expect(captured).toHaveLength(3)
    expect(waits).toEqual([1000, 2000])
  })

  test.each([[408], [429], [500], [502], [503]])('retries %p', async (status) => {
    const { captured, send } = harness([{ status }, {}])

    await send('/chat/completions', { method: 'POST' })

    expect(captured).toHaveLength(2)
  })

  test.each([[400], [401], [403], [404], [422], [501]])('does not retry %p', async (status) => {
    // Every one of these is a statement about the request. Repeating it changes
    // nothing, and a wrong key would burn three calls saying so.
    const { captured, send } = harness([{ status }])

    await send('/chat/completions', { method: 'POST' })

    expect(captured).toHaveLength(1)
  })

  test('waits as long as the provider asked, when it said', async () => {
    const { send, waits } = harness([{ status: 429, headers: { 'retry-after': '7' } }, {}])

    await send('/chat/completions', { method: 'POST' })

    expect(waits).toEqual([7000])
  })

  test.each([['GET'], ['HEAD']])('sends no body on a %s, which fetch rejects outright', async (method) => {
    // Buffering for the retry means every request now has a body read from it,
    // and an empty one on a bodiless method is not the same as none.
    const { captured, send } = harness()

    await send('/models', { method })

    expect(captured[0]?.method).toBe(method)
    expect(captured[0]?.body).toBeUndefined()
  })
})

describe('backoffFor', () => {
  test('doubles each attempt when the provider said nothing', () => {
    expect([backoffFor(1, null), backoffFor(2, null), backoffFor(3, null)]).toEqual([1000, 2000, 4000])
  })

  test('prefers Retry-After, which knows when the window resets', () => {
    expect(backoffFor(1, '5')).toBe(5000)
  })

  test('honours a Retry-After of zero rather than falling back', () => {
    // "the window is already open" is an answer, not a missing header.
    expect(backoffFor(1, '0')).toBe(0)
  })

  test('caps a Retry-After that would park the job', () => {
    expect(backoffFor(1, '3600')).toBe(20_000)
  })

  test('caps the exponential too', () => {
    expect(backoffFor(20, null)).toBe(20_000)
  })

  test.each([['soon'], ['-1'], ['Wed, 21 Oct 2015 07:28:00 GMT']])(
    'falls back to the exponential for the unusable %p',
    (header) => {
      expect(backoffFor(1, header)).toBe(1000)
    },
  )
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
    selfLoginOverride: 'agent-bot',
    selfWorkflowName: 'OpenCode Issue Agent',
    openai: SETTINGS,
    commitAuthorName: 'agent',
    commitAuthorEmail: 'agent@example.com',
    checkCommand: 'bun test',
    reviewCommand: null,
    reviewMaxRounds: 2,
    reviewPoolSize: 1,
    agentTimeoutMs: 1000,
    stallTimeoutMs: 300_000,
    jobDeadlineMs: null,
    teardownReserveMs: 180_000,
    wrapUpMs: 120_000,
    ciFixMaxRounds: 2,
    commitRepairMaxRounds: 3,
    syncRepairMaxRounds: 3,
    maxCiAttempts: 2,
    maxReviewAttempts: 3,
    reviewHintLines: 200,
    maxAttempts: 3,
    maxTokens: 5_000_000,
    diffLimits: { maxFiles: 100, maxLines: 20_000 },
    gitRemoteBase: 'https://github.com/',
    runUrl: null,
    labelPrefix: 'agent:',
    logKey: null,
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
    commentId: null,
    repositoryOwner: 'acme',
    defaultBranch: 'master',
  }

  /**
   * The real adapter, built the way `runCli` builds it — it opens no socket
   * until something calls it, and `contain` only hands it on.
   */
  const github = (): GitHubApi =>
    createOctokitApi({
      token: 'tok',
      owner: 'acme',
      repo: 'widgets',
      secrets: [KEY],
      fetch: (): Promise<Response> =>
        Promise.resolve(
          new Response(JSON.stringify({ login: 'maintainer', id: 42 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        ),
    })

  const contained = (): Promise<Contained> =>
    contain({
      config: config(),
      event,
      log: silentLog,
      run: () => Promise.resolve({ command: '', exitCode: 0, stdout: '', stderr: '' }),
      options: { argv: [], env: {} },
      github: github(),
    })

  test('the pipeline actually applies it, not just the proxy module', async () => {
    // The adapter can be perfect and still never be wired in: a mutation
    // replacing the contained config with the raw one killed no test until this
    // existed. Same shape as the outbound-redaction gap in S3-3.
    const run = await contained()

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

  test('builds the session with the configured turn timeout', async () => {
    // S5-2's wiring, which is the half that has gone missing three times in this
    // workspace: the deadline is in the adapter, and nothing reached it.
    const seen: OpenCodeAgentOptions[] = []
    const run = await contain({
      config: config(),
      event,
      log: silentLog,
      run: () => Promise.resolve({ command: '', exitCode: 0, stdout: '', stderr: '' }),
      options: { argv: [], env: {} },
      github: github(),
      createAgent: (agentOptions) => {
        seen.push(agentOptions)
        return Promise.resolve({
          sessionId: 's',
          prompt: () => Promise.resolve({ text: '', sessionId: 's' }),
          tokensUsed: () => Promise.resolve(0),
          abort: () => Promise.resolve(true),
          close: () => Promise.resolve(),
        })
      },
    })

    await run.deps.agent()

    // Asked rather than read: the bound is a function so that every turn in a job
    // gets one sized against the clock as it reads *then*, which is what a job
    // running a turn per plan step needs and a number could not give it.
    expect(asked(seen[0])).toBe(1000)
    // And a logger, without which the adapter has nowhere to report progress.
    expect(seen[0]?.log).toBeDefined()
    // And still the contained credential, not the real one.
    expect(seen[0]?.openai.apiKey).toBe(PLACEHOLDER_API_KEY)
    await run.proxy.close()
  })

  test('shrinks the turn timeout to what is left of the job', async () => {
    // The same wiring gap one level along, and the one the finding is about: the
    // turn cap and the job's own `timeout-minutes` were two numbers in two files
    // kept in step by hand, so a turn opened near the end of a job was allowed to
    // wait past the runner that kills it — which posts nothing at all. Asserted
    // here because `turnTimeoutMs` being correct and never reaching the session is
    // exactly how the deadline shipped broken once already.
    const seen: OpenCodeAgentOptions[] = []
    const nowMs = Date.UTC(2026, 7, 8, 12, 0)
    const run = await contain({
      // 90 seconds of job left, 30 of it reserved for the stop and 10 for the
      // wrap-up: nothing like the 600s cap, and the smaller number has to win.
      config: {
        ...config(),
        agentTimeoutMs: 600_000,
        jobDeadlineMs: nowMs + 90_000,
        teardownReserveMs: 30_000,
        wrapUpMs: 10_000,
      },
      event,
      log: silentLog,
      run: () => Promise.resolve({ command: '', exitCode: 0, stdout: '', stderr: '' }),
      options: { argv: [], env: {} },
      github: github(),
      now: () => nowMs,
      createAgent: (agentOptions) => {
        seen.push(agentOptions)
        return Promise.resolve({
          sessionId: 's',
          prompt: () => Promise.resolve({ text: '', sessionId: 's' }),
          tokensUsed: () => Promise.resolve(0),
          abort: () => Promise.resolve(true),
          close: () => Promise.resolve(),
        })
      },
    })

    await run.deps.agent()

    expect(asked(seen[0])).toBe(50_000)
    await run.proxy.close()
  })

  test('re-reads the turn bound for every turn, not once when the session boots', async () => {
    // The hole stage 3 would otherwise open. The session is memoized for the whole
    // job and a job now runs one turn per plan step, so a bound read once is a bound
    // sized against a clock that has since moved: a step starting six minutes before
    // the runner's own `timeout-minutes` would carry the thirty-minute cap and be
    // killed with the job, which posts nothing at all.
    const seen: OpenCodeAgentOptions[] = []
    const nowMs = Date.UTC(2026, 7, 8, 12, 0)
    let clock = nowMs
    const run = await contain({
      config: {
        ...config(),
        agentTimeoutMs: 600_000,
        jobDeadlineMs: nowMs + 300_000,
        teardownReserveMs: 30_000,
        wrapUpMs: 10_000,
      },
      event,
      log: silentLog,
      run: () => Promise.resolve({ command: '', exitCode: 0, stdout: '', stderr: '' }),
      options: { argv: [], env: {} },
      github: github(),
      now: () => clock,
      createAgent: (agentOptions) => {
        seen.push(agentOptions)
        return Promise.resolve({
          sessionId: 's',
          prompt: () => Promise.resolve({ text: '', sessionId: 's' }),
          tokensUsed: () => Promise.resolve(0),
          abort: () => Promise.resolve(true),
          close: () => Promise.resolve(),
        })
      },
    })

    await run.deps.agent()
    expect(asked(seen[0])).toBe(260_000)

    clock += 120_000
    expect(asked(seen[0])).toBe(140_000)
    await run.proxy.close()
  })

  test('hands the phases the same clock the session was sized against', async () => {
    // One clock per run, not one per module: the deadline the cascade checks and
    // the deadline the session was handed have to be the same wall clock, or a
    // phase can be refused for want of time the turn thinks it has.
    const nowMs = Date.UTC(2026, 7, 8, 12, 0)
    const run = await contain({
      config: config(),
      event,
      log: silentLog,
      run: () => Promise.resolve({ command: '', exitCode: 0, stdout: '', stderr: '' }),
      options: { argv: [], env: {} },
      github: github(),
      now: () => nowMs,
    })

    expect(run.deps.now()).toBe(nowMs)
    await run.proxy.close()
  })

  test('keeps the real credentials for the guards that need them', async () => {
    // Scrubbing, outbound redaction and the diff guard all protect the *value*,
    // so containment must not hide it from them.
    const run = await contained()

    expect(JSON.stringify(run.deps.config)).not.toContain(KEY)
    await run.proxy.close()
  })
})
