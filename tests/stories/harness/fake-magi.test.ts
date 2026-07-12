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

describe('fake magi', () => {
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
      prompt: 'Add health check',
      projectSpec: {
        agent: 'claude',
        baseBranch: 'main',
        name: 'papai',
        permissionPreset: 'cautious',
        repoUrl: 'https://github.com/acme/papai.git',
      },
      environmentNames: ['ANTHROPIC_API_KEY'],
      forgeIncluded: false,
    })
  })

  test('rejects invalid JSON and invalid session request shapes', async () => {
    const invalidJson = setup()
    invalidJson.magi.expectStartSession({ id: 'session-1' })
    expect(
      await causeMessage(
        invalidJson.http.fetch(`${BASE_URL}/sessions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${TOKEN}` },
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
          headers: { authorization: `Bearer ${TOKEN}` },
          body: JSON.stringify({ contextId: 'ctx', prompt: 'work', projectSpec: {} }),
        }),
      ),
    ).toContain('rejected POST /sessions')
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
