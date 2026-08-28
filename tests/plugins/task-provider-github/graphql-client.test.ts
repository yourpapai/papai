// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import type { ProviderRequestObservation } from '../../../src/analytics/provider-observer.js'
import {
  createActorProviderRequestScope,
  NO_ANALYTICS_SCOPE,
  runWithProviderRequestScope,
} from '../../../src/analytics/provider-request-scope.js'
import type { AnalyticsSourceContext } from '../../../src/analytics/source-facts.js'
import { createTrackedLoggerMock } from '../../utils/logger-mock.js'
import { restoreFetch, setMockFetch } from '../../utils/test-helpers.js'

const tracked = createTrackedLoggerMock()
// Top-level mock + delayed import: the module under test must load after the logger mock installs.
void mock.module('../../../src/logger.js', () => ({ logger: tracked.logger, getLogLevel: tracked.getLogLevel }))

const { resolveGraphqlEndpoint, githubGraphql, GitHubGraphqlError } =
  await import('../../../plugins/task-provider-github/graphql-client.js')
const { GitHubApiError } = await import('../../../plugins/task-provider-github/client.js')

afterEach(() => {
  restoreFetch()
  tracked.clearCalls()
})

type EndpointCase = Readonly<{
  label: string
  baseUrl: string
  expected: string
}>

const endpointCases: EndpointCase[] = [
  {
    label: 'an empty baseUrl resolves to the public GraphQL endpoint',
    baseUrl: '',
    expected: 'https://api.github.com/graphql',
  },
  {
    label: 'an explicit public REST base resolves to the public GraphQL endpoint',
    baseUrl: 'https://api.github.com',
    expected: 'https://api.github.com/graphql',
  },
  {
    label: 'a GHES /api/v3 base swaps the suffix for /api/graphql on the same origin',
    baseUrl: 'https://ghes.example.com/api/v3',
    expected: 'https://ghes.example.com/api/graphql',
  },
  {
    label: 'a GHES /api/v3 base behind a sub-path prefix keeps the prefix and swaps the suffix',
    baseUrl: 'https://corp.example.com/gh/api/v3',
    expected: 'https://corp.example.com/gh/api/graphql',
  },
  {
    label: 'a GHES bare origin appends /api/graphql',
    baseUrl: 'https://ghes.example.com',
    expected: 'https://ghes.example.com/api/graphql',
  },
  {
    label: 'trailing slashes on a GHES /api/v3 base are stripped before the suffix swap',
    baseUrl: 'https://ghes.example.com/api/v3///',
    expected: 'https://ghes.example.com/api/graphql',
  },
  {
    label: 'trailing slashes on the public base still resolve to the public GraphQL endpoint',
    baseUrl: 'https://api.github.com///',
    expected: 'https://api.github.com/graphql',
  },
]

describe('resolveGraphqlEndpoint', () => {
  test.each(endpointCases)('$label', ({ baseUrl, expected }: EndpointCase) => {
    expect(resolveGraphqlEndpoint(baseUrl)).toBe(expected)
  })
})

const GQL_TOKEN = 'gql-canary-token'
const GQL_QUERY = 'query($login: String!) { canaryField(login: $login) { payload } }'
const GQL_VARIABLES = { login: 'canary-variables-login' }

const gqlConfig = { baseUrl: '', repo: 'octocat/hello-world', token: GQL_TOKEN }

type SentRequest = Readonly<{
  url: string
  method: string
  headers: Record<string, string>
  body: string | null
}>

const gqResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } })

const postSink = (sent: SentRequest[], reply: () => Response): void => {
  setMockFetch((url, init) => {
    sent.push({
      url,
      method: init.method ?? '',
      headers: Object.fromEntries(new Headers(init.headers)),
      body: typeof init.body === 'string' ? init.body : null,
    })
    return Promise.resolve(reply())
  })
}

const sourceContext = (): AnalyticsSourceContext => ({
  platform: 'mattermost',
  platformInstanceId: 'mm-9',
  chatUserId: 'gql-user-3',
  nativeContextId: 'thread-31',
  storageContextId: 'mm-9:thread-31',
  configContextId: 'mm-9:thread-31',
  contextType: 'group',
  actorRole: 'admin',
  taskInstanceId: 'ti-gql-7',
  taskProvider: 'other',
  invocationMode: 'proactive',
  rawTurnId: 'turn-gql',
})

type ObservationSink = Readonly<{
  observations: ProviderRequestObservation[]
  scope: ReturnType<typeof createActorProviderRequestScope>
}>

const observationSink = (): ObservationSink => {
  const observations: ProviderRequestObservation[] = []
  const scope = createActorProviderRequestScope({
    requestContext: { source: sourceContext(), sourceEventId: 'turn-gql:observe' },
    observeProviderRequest: (_requestContext, observation) => {
      observations.push(observation)
    },
  })
  return { observations, scope }
}

const logDump = (): string => JSON.stringify(tracked.getCalls())

describe('githubGraphql request shape', () => {
  test('POSTs the query and variables as JSON to the derived endpoint with bearer auth only', async () => {
    const sent: SentRequest[] = []
    postSink(sent, () => gqResponse({ data: { ok: true } }))
    await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () => githubGraphql(gqlConfig, GQL_QUERY, GQL_VARIABLES))
    expect(sent).toHaveLength(1)
    const request = sent[0]
    assert.ok(request !== undefined)
    expect(request.url).toBe('https://api.github.com/graphql')
    expect(request.method).toBe('POST')
    expect(Object.keys(request.headers).sort()).toEqual(['authorization', 'content-type'])
    expect(request.headers['authorization']).toBe(`Bearer ${GQL_TOKEN}`)
    expect(request.headers['content-type']).toBe('application/json')
    assert.ok(typeof request.body === 'string')
    expect(JSON.parse(request.body)).toEqual({ query: GQL_QUERY, variables: GQL_VARIABLES })
  })
})

describe('githubGraphql envelope', () => {
  test.each([
    ['without an errors key', { data: { node: { id: 'PVT_kwDO' } } }, { node: { id: 'PVT_kwDO' } }],
    ['with an empty errors array', { data: { node: { id: 'PVT_empty' } }, errors: [] }, { node: { id: 'PVT_empty' } }],
  ])('returns data untouched %s', async (_label: string, payload: unknown, expected: unknown) => {
    setMockFetch(() => Promise.resolve(gqResponse(payload)))
    const data = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubGraphql(gqlConfig, GQL_QUERY, GQL_VARIABLES),
    )
    expect(data).toEqual(expected)
  })

  type EnvelopeError = Readonly<{ message: string; type?: string; extensions?: Readonly<{ type?: string }> }>

  test.each([
    ['a top-level type', { message: 'first failure', type: 'NOT_FOUND' }, 'NOT_FOUND'],
    ['an extensions.type', { message: 'scope miss', extensions: { type: 'FORBIDDEN' } }, 'FORBIDDEN'],
    [
      'extensions.type winning over a top-level type',
      { message: 'both present', type: 'FORBIDDEN', extensions: { type: 'INSUFFICIENT_SCOPES' } },
      'INSUFFICIENT_SCOPES',
    ],
    ['no type at all', { message: 'untyped failure' }, undefined],
  ])(
    'fails the whole call on errors[] carrying %s',
    async (_label: string, entry: EnvelopeError, expectedType: string | undefined) => {
      setMockFetch(() =>
        Promise.resolve(
          gqResponse({
            data: { partial: true },
            errors: [entry, { message: 'second failure' }],
          }),
        ),
      )
      const error: unknown = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
        githubGraphql(gqlConfig, GQL_QUERY, GQL_VARIABLES).catch((caught: unknown) => caught),
      )
      assert.ok(error instanceof GitHubGraphqlError)
      expect(error.message).toBe(entry.message)
      expect(error.type).toBe(expectedType)
      expect(error.errors).toEqual([entry, { message: 'second failure' }])
      expect(logDump()).not.toContain(GQL_QUERY)
      expect(logDump()).not.toContain('canary-variables-login')
    },
  )

  test.each([
    ['a non-JSON body', (): Response => new Response('<html>gateway noise</html>', { status: 200 })],
    ['a JSON array body', (): Response => gqResponse([1, 2, 3])],
    ['an errors entry without a message', (): Response => gqResponse({ errors: [{ type: 'NOT_FOUND' }] })],
  ])('rejects %s as an envelope-validation failure', async (_label: string, respond: () => Response) => {
    setMockFetch(() => Promise.resolve(respond()))
    const error: unknown = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubGraphql(gqlConfig, GQL_QUERY).catch((caught: unknown) => caught),
    )
    assert.ok(error instanceof GitHubGraphqlError)
    expect(error.message).toContain('envelope')
    expect(error.type).toBeUndefined()
    expect(error.errors).toEqual([])
  })

  test('fails the whole call on errors[] without a data key (pre-execution failure shape)', async () => {
    setMockFetch(() => Promise.resolve(gqResponse({ errors: [{ message: 'rate limited', type: 'RATE_LIMITED' }] })))
    const error: unknown = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubGraphql(gqlConfig, GQL_QUERY).catch((caught: unknown) => caught),
    )
    assert.ok(error instanceof GitHubGraphqlError)
    expect(error.message).toBe('rate limited')
    expect(error.type).toBe('RATE_LIMITED')
    expect(error.errors).toEqual([{ message: 'rate limited', type: 'RATE_LIMITED' }])
    expect(error.message).not.toContain('envelope')
  })

  test('maps a non-2xx response to GitHubApiError with status, headers, and parsed body', async () => {
    setMockFetch(() => Promise.resolve(gqResponse({ message: 'Not Found' }, 404)))
    const error: unknown = await runWithProviderRequestScope(NO_ANALYTICS_SCOPE, () =>
      githubGraphql(gqlConfig, GQL_QUERY).catch((caught: unknown) => caught),
    )
    assert.ok(error instanceof GitHubApiError)
    expect(error.statusCode).toBe(404)
    expect(error.body).toEqual({ message: 'Not Found' })
    expect(error.message).not.toContain(GQL_QUERY)
  })
})

describe('githubGraphql boundary observation', () => {
  test('observes a successful call as provider github with the default read operation', async () => {
    const { observations, scope } = observationSink()
    setMockFetch(() => Promise.resolve(gqResponse({ data: { viewer: { login: 'octocat' } } })))
    await runWithProviderRequestScope(scope, () => githubGraphql(gqlConfig, GQL_QUERY, GQL_VARIABLES))
    expect(observations).toHaveLength(1)
    expect(observations[0]).toMatchObject({
      provider: 'github',
      operation: 'read',
      outcome: 'success',
      statusClass: '2xx',
      retryable: null,
    })
    expect(observations[0]?.durationMs).toBeGreaterThanOrEqual(0)
    expect(logDump()).not.toContain(GQL_TOKEN)
    expect(logDump()).not.toContain(GQL_QUERY)
    expect(logDump()).not.toContain('canary-variables-login')
    expect(JSON.stringify(observations)).not.toContain(GQL_TOKEN)
  })

  test('observes an explicitly passed operation label', async () => {
    const { observations, scope } = observationSink()
    setMockFetch(() => Promise.resolve(gqResponse({ data: { mutation: true } })))
    await runWithProviderRequestScope(scope, () => githubGraphql(gqlConfig, GQL_QUERY, undefined, 'create'))
    expect(observations[0]).toMatchObject({ operation: 'create', outcome: 'success' })
  })

  test('observes a 200-with-errors call as a truthfully unclassed failure', async () => {
    const { observations, scope } = observationSink()
    setMockFetch(() =>
      Promise.resolve(gqResponse({ errors: [{ message: 'insufficient', type: 'INSUFFICIENT_SCOPES' }] })),
    )
    await runWithProviderRequestScope(scope, () => githubGraphql(gqlConfig, GQL_QUERY).catch(() => undefined))
    expect(observations[0]).toMatchObject({ outcome: 'failure', statusClass: 'other', retryable: null })
  })

  test('observes a non-2xx failure through the status classification', async () => {
    const { observations, scope } = observationSink()
    setMockFetch(() => Promise.resolve(gqResponse({ message: 'bad gateway' }, 502)))
    await runWithProviderRequestScope(scope, () => githubGraphql(gqlConfig, GQL_QUERY).catch(() => undefined))
    expect(observations[0]).toMatchObject({ outcome: 'failure', statusClass: '5xx', retryable: true })
  })
})
