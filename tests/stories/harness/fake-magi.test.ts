// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { createScenarioEvents } from './events.js'
import { createFakeMagi, type FakeMagi } from './fake-magi.js'
import { createStrictHttpDispatcher, type StrictHttpDispatcher } from './strict-http.js'

const BASE_URL = 'https://magi.invalid'
const TOKEN = 'magi-secret-token'

type Setup = Readonly<{
  events: ReturnType<typeof createScenarioEvents>
  http: StrictHttpDispatcher
  magi: FakeMagi
}>

function setup(): Setup {
  const events = createScenarioEvents('fake magi')
  const http = createStrictHttpDispatcher(events)
  const magi = createFakeMagi({ http, events, baseUrl: BASE_URL, token: TOKEN })
  return { events, http, magi }
}

async function causeMessage(promise: Promise<unknown>): Promise<string> {
  const failure: unknown = await promise.catch((error: unknown) => error)
  if (!(failure instanceof Error) || !(failure.cause instanceof Error)) return ''
  return failure.cause.message
}

function validProjectSpec(): Record<string, unknown> {
  return {
    name: 'papai',
    repoUrl: 'https://github.com/acme/papai.git',
    baseBranch: 'main',
    permissionPreset: 'cautious',
    agent: 'claude',
  }
}

function validStartBody(): Record<string, unknown> {
  return {
    agent: 'claude-code-acp',
    contextId: 'pi:dm:user-1',
    prompt: 'Add health check',
    secrets: { ANTHROPIC_API_KEY: 'provider-secret' },
    projectSpec: validProjectSpec(),
  }
}

function rejectedStartMessage(body: unknown): Promise<string> {
  const { http, magi } = setup()
  magi.expectStartSession({ id: 'session-invalid' })
  return causeMessage(
    http.fetch(`${BASE_URL}/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )
}

describe('fake magi', () => {
  test('serves declared ACP lifecycle routes with exact encoded requests and sanitized events', async () => {
    const { events, http, magi } = setup()
    const sessionId = 'session/alpha one'
    const encodedSessionId = encodeURIComponent(sessionId)
    const lifecycleSecret = 'lifecycle-provider-secret'
    const forgeSecret = 'lifecycle-forge-secret'
    const mcpSecret = 'lifecycle-mcp-secret'

    magi.expectAgents([{ id: 'claude', name: 'Claude' }])
    magi.expectSessions('active', [{ id: sessionId, status: 'running' }])
    magi.expectSession(sessionId, { id: sessionId, status: 'running' })
    magi.expectPermissions(sessionId, [{ toolCallId: 'call-1' }, { toolCallId: 'call-2' }])
    magi.expectPermissionDecision(sessionId, { toolCallId: 'call-1', decision: 'allow' })
    magi.expectPermissionDecision(sessionId, { toolCallId: 'call-2', decision: 'deny' })
    magi.expectFinish(sessionId, {
      action: 'pr',
      message: 'create pull request',
      title: 'private title',
      body: 'private body',
      forgeToken: forgeSecret,
    })
    magi.expectCancel(sessionId)
    magi.expectFollowUp(sessionId, {
      prompt: 'private follow-up prompt',
      contextId: 'pi:dm:alice',
      secrets: { ANTHROPIC_API_KEY: lifecycleSecret },
      forgeToken: forgeSecret,
      mcpTokens: { docs: mcpSecret },
    })

    await http.fetch(`${BASE_URL}/agents`, { headers: { authorization: `Bearer ${TOKEN}` } })
    await http.fetch(`${BASE_URL}/sessions?filter=active`, { headers: { authorization: `Bearer ${TOKEN}` } })
    await http.fetch(`${BASE_URL}/sessions/${encodedSessionId}`, { headers: { authorization: `Bearer ${TOKEN}` } })
    await http.fetch(`${BASE_URL}/sessions/${encodedSessionId}/permissions`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    await http.fetch(`${BASE_URL}/sessions/${encodedSessionId}/permission`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId: 'call-1', decision: 'allow' }),
    })
    await http.fetch(`${BASE_URL}/sessions/${encodedSessionId}/permission`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ toolCallId: 'call-2', decision: 'deny' }),
    })
    await http.fetch(`${BASE_URL}/sessions/${encodedSessionId}/finish`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'pr',
        message: 'create pull request',
        title: 'private title',
        body: 'private body',
        forgeToken: forgeSecret,
      }),
    })
    await http.fetch(`${BASE_URL}/sessions/${encodedSessionId}/cancel`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}` },
    })
    await http.fetch(`${BASE_URL}/sessions/${encodedSessionId}/follow-up`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        prompt: 'private follow-up prompt',
        contextId: 'pi:dm:alice',
        secrets: { ANTHROPIC_API_KEY: lifecycleSecret },
        forgeToken: forgeSecret,
        mcpTokens: { docs: mcpSecret },
      }),
    })

    magi.verifyConsumed()
    expect(
      events
        .all()
        .filter(({ kind }) => kind.startsWith('magi.'))
        .map(({ kind, data }) => ({ kind, data })),
    ).toEqual([
      { kind: 'magi.agents.list', data: { count: 1, status: 200 } },
      { kind: 'magi.sessions.list', data: { count: 1, status: 200 } },
      { kind: 'magi.session.status', data: { sessionId, status: 200 } },
      { kind: 'magi.permissions.list', data: { count: 2, sessionId, status: 200 } },
      { kind: 'magi.permission.answer', data: { decision: 'allow', sessionId, status: 200, toolCallId: 'call-1' } },
      { kind: 'magi.permission.answer', data: { decision: 'deny', sessionId, status: 200, toolCallId: 'call-2' } },
      { kind: 'magi.session.finish', data: { action: 'pr', sessionId, status: 200 } },
      { kind: 'magi.session.cancel', data: { sessionId, status: 200 } },
      { kind: 'magi.session.follow_up', data: { sessionId, status: 202 } },
    ])
    const trace = JSON.stringify(events.all())
    expect(trace).not.toContain(TOKEN)
    expect(trace).not.toContain(lifecycleSecret)
    expect(trace).not.toContain(forgeSecret)
    expect(trace).not.toContain(mcpSecret)
    expect(trace).not.toContain('private follow-up prompt')
    expect(trace).not.toContain('private title')
    expect(trace).not.toContain('private body')
  })

  test('rejects unencoded session IDs, invalid authorization, and lifecycle body mismatches', async () => {
    const malformedId = setup()
    malformedId.magi.expectSession('session/one', { id: 'session/one', status: 'running' })
    await expect(
      malformedId.http.fetch(`${BASE_URL}/sessions/session/one`, { headers: { authorization: `Bearer ${TOKEN}` } }),
    ).rejects.toThrow(
      `expected GET ${BASE_URL}/sessions/session%2Fone but received GET ${BASE_URL}/sessions/session/one`,
    )

    const wrongAuthorization = setup()
    wrongAuthorization.magi.expectCancel('session-1')
    expect(
      await causeMessage(
        wrongAuthorization.http.fetch(`${BASE_URL}/sessions/session-1/cancel`, {
          method: 'POST',
          headers: { authorization: 'Bearer wrong-lifecycle-token' },
        }),
      ),
    ).toContain('rejected authorization')

    const wrongBody = setup()
    wrongBody.magi.expectPermissionDecision('session-1', { toolCallId: 'call-1', decision: 'allow' })
    expect(
      await causeMessage(
        wrongBody.http.fetch(`${BASE_URL}/sessions/session-1/permission`, {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ toolCallId: 'call-1', decision: 'deny' }),
        }),
      ),
    ).toContain('expected exact JSON body')

    const readWithContentType = setup()
    readWithContentType.magi.expectAgents([])
    expect(
      await causeMessage(
        readWithContentType.http.fetch(`${BASE_URL}/agents`, {
          headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
        }),
      ),
    ).toContain('expected no Content-Type')
  })

  test('returns declared lifecycle failure responses without recording their payloads', async () => {
    const { events, http, magi } = setup()
    magi.expectSession(
      'session-1',
      { ignored: 'private response body' },
      { body: { error: 'upstream unavailable' }, status: 503 },
    )

    const response = await http.fetch(`${BASE_URL}/sessions/session-1`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'upstream unavailable' })
    expect(events.all().find(({ kind }) => kind === 'magi.session.status')?.data).toEqual({
      sessionId: 'session-1',
      status: 503,
    })
    expect(JSON.stringify(events.all())).not.toContain('private response body')
    expect(JSON.stringify(events.all())).not.toContain('upstream unavailable')
  })

  test('rejects successful statuses declared for a start failure', () => {
    const { magi } = setup()

    expect(() => magi.expectStartFailure({ status: 202, body: { error: 'not a failure' } })).toThrow(
      'Fake magi start failure must use a non-2xx status',
    )
  })

  test('serves agents, session creation, filtered listing, and status in exact order', async () => {
    const { events, http, magi } = setup()
    magi.expectAgents([{ id: 'claude-code-acp', name: 'Claude' }])
    magi.expectStartSession({
      id: 'session-1',
      expected: { contextId: 'pi:dm:user-1', prompt: 'Add health check', project: 'papai', agent: 'claude' },
    })
    magi.expectSessions('active', [{ id: 'session-1', status: 'running' }])
    magi.expectSession('session-1', { id: 'session-1', status: 'running' })

    expect(
      await (await http.fetch(`${BASE_URL}/agents`, { headers: { authorization: `Bearer ${TOKEN}` } })).json(),
    ).toEqual([{ id: 'claude-code-acp', name: 'Claude' }])
    const startResponse = await http.fetch(`${BASE_URL}/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        agent: 'claude-code-acp',
        contextId: 'pi:dm:user-1',
        prompt: 'Add health check',
        secrets: { ANTHROPIC_API_KEY: 'provider-secret' },
        projectSpec: {
          name: 'papai',
          repoUrl: 'https://github.com/acme/papai.git',
          baseBranch: 'main',
          permissionPreset: 'cautious',
          agent: 'claude',
        },
      }),
    })
    expect(startResponse.status).toBe(202)
    expect(await startResponse.json()).toEqual({
      id: 'session-1',
      status: 'queued',
      shareToken: 'share-session-1',
      transcriptUrl: 'https://papai.invalid/t/share-session-1',
    })
    expect(
      await (
        await http.fetch(`${BASE_URL}/sessions?filter=active`, {
          headers: { authorization: `Bearer ${TOKEN}` },
        })
      ).json(),
    ).toEqual([{ id: 'session-1', status: 'running' }])
    expect(
      await (
        await http.fetch(`${BASE_URL}/sessions/session-1`, { headers: { authorization: `Bearer ${TOKEN}` } })
      ).json(),
    ).toEqual({
      id: 'session-1',
      status: 'running',
    })

    magi.verifyConsumed()
    expect(JSON.stringify(events.all())).not.toContain(TOKEN)
    expect(JSON.stringify(events.all())).not.toContain('provider-secret')
    expect(events.all().find(({ kind }) => kind === 'magi.session.start')?.data).toEqual({
      agent: 'claude-code-acp',
      contextId: 'pi:dm:user-1',
      project: 'papai',
      status: 202,
    })
  })

  test('rejects invalid JSON and invalid session request shapes', async () => {
    const invalidJson = setup()
    invalidJson.magi.expectStartSession({ id: 'session-1' })
    expect(
      await causeMessage(
        invalidJson.http.fetch(`${BASE_URL}/sessions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
          body: '{',
        }),
      ),
    ).toContain('valid JSON')

    const invalidShape = setup()
    invalidShape.magi.expectStartSession({ id: 'session-1' })
    expect(
      await causeMessage(
        invalidShape.http.fetch(`${BASE_URL}/sessions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
          body: JSON.stringify({ contextId: 'ctx', prompt: 'work', projectSpec: {} }),
        }),
      ),
    ).toContain('rejected POST /sessions')
  })

  test('requires application/json while accepting a case-insensitive charset parameter', async () => {
    const missing = setup()
    missing.magi.expectStartSession({ id: 'missing-content-type' })
    expect(
      await causeMessage(
        missing.http.fetch(`${BASE_URL}/sessions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify(validStartBody()),
        }),
      ),
    ).toContain('Content-Type application/json')

    const wrong = setup()
    wrong.magi.expectStartSession({ id: 'wrong-content-type' })
    expect(
      await causeMessage(
        wrong.http.fetch(`${BASE_URL}/sessions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'text/plain' },
          body: JSON.stringify(validStartBody()),
        }),
      ),
    ).toContain('Content-Type application/json')

    const accepted = setup()
    accepted.magi.expectStartSession({ id: 'accepted-content-type' })
    const response = await accepted.http.fetch(`${BASE_URL}/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'Application/JSON; Charset=UTF-8' },
      body: JSON.stringify(validStartBody()),
    })
    expect(response.status).toBe(202)
  })

  test('rejects unknown top-level, project, and nested project fields', async () => {
    expect(await rejectedStartMessage({ ...validStartBody(), unexpected: true })).toContain('rejected POST /sessions')
    expect(
      await rejectedStartMessage({
        ...validStartBody(),
        projectSpec: { ...validProjectSpec(), unexpected: true },
      }),
    ).toContain('rejected POST /sessions')
    expect(
      await rejectedStartMessage({
        ...validStartBody(),
        projectSpec: {
          ...validProjectSpec(),
          forge: { kind: 'github', apiBaseUrl: 'https://api.github.com', unexpected: true },
        },
      }),
    ).toContain('rejected POST /sessions')
    expect(
      await rejectedStartMessage({
        ...validStartBody(),
        projectSpec: {
          ...validProjectSpec(),
          mcp: [
            {
              id: 'docs',
              url: 'https://mcp.invalid',
              host: 'mcp.invalid',
              header: 'authorization',
              allowedHosts: ['mcp.invalid'],
              unexpected: true,
            },
          ],
        },
      }),
    ).toContain('rejected POST /sessions')
  })

  test('records the complete validated request shape without credential values', async () => {
    const { events, http, magi } = setup()
    magi.expectStartSession({ id: 'session-full' })
    const projectSpec = {
      ...validProjectSpec(),
      additionalEgressDomains: ['packages.example.com'],
      forge: { kind: 'github', apiBaseUrl: 'https://api.github.com' },
      providerHost: 'api.anthropic.com',
      model: 'claude-sonnet',
      mcp: [
        {
          id: 'docs',
          url: 'https://mcp.invalid',
          host: 'mcp.invalid',
          header: 'authorization',
          allowedHosts: ['mcp.invalid'],
          toolPolicy: { default: 'ask', tools: { read_docs: 'allow' } },
        },
      ],
    }
    await http.fetch(`${BASE_URL}/sessions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        ...validStartBody(),
        projectSpec,
        forgeToken: 'forge-private',
        prNumber: 42,
        mcpTokens: { docs: 'mcp-private' },
      }),
    })

    expect(events.all().find(({ kind }) => kind === 'magi.session.start')?.data).toEqual({
      agent: 'claude-code-acp',
      contextId: 'pi:dm:user-1',
      project: 'papai',
      status: 202,
    })
    const trace = JSON.stringify(events.all())
    expect(trace).not.toContain('forge-private')
    expect(trace).not.toContain('mcp-private')
  })

  test('fails on wrong authorization without exposing the supplied token', async () => {
    const { http, magi } = setup()
    magi.expectAgents([])
    expect(
      await causeMessage(
        http.fetch(`${BASE_URL}/agents`, { headers: { authorization: 'Bearer wrong-private-token' } }),
      ),
    ).toContain('rejected authorization')
    try {
      await http.fetch(`${BASE_URL}/agents`, { headers: { authorization: 'Bearer another-private-token' } })
    } catch (failure) {
      expect(String(failure)).not.toContain('another-private-token')
    }
  })

  test('delegates ordering, unexpected-request, and leftover checks to strict HTTP', async () => {
    const wrongOrder = setup()
    wrongOrder.magi.expectAgents([])
    wrongOrder.magi.expectSessions('done', [])
    await expect(wrongOrder.http.fetch(`${BASE_URL}/sessions?filter=done`)).rejects.toThrow(
      `expected GET ${BASE_URL}/agents but received GET ${BASE_URL}/sessions?filter=done`,
    )

    const unexpected = setup()
    await expect(unexpected.http.fetch(`${BASE_URL}/agents`)).rejects.toThrow('undeclared request')

    const leftover = setup()
    leftover.magi.expectSession('session-2', { id: 'session-2', status: 'done' })
    expect(() => leftover.magi.verifyConsumed()).toThrow('unconsumed HTTP expectations')
  })
})
