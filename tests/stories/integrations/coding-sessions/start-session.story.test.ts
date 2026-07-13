// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { updateCodingCredentials } from '../../../../src/coding-credentials/store.js'
import { upsertRepo } from '../../../../src/coding-repos/store.js'
import { getCodingSessionRecord } from '../../../../src/coding-sessions/store.js'
import { createFakeMagi } from '../../harness/fake-magi.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability } from '../../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-magi-token'
const PROVIDER_KEY = 'scenario-provider-key'

scenario('starts a coding session through the real capability and tool loop', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const contextId = toScopedContextId({ platformInstanceId: alice.platformInstanceId, nativeContextId: alice.id })
  given.codingSession({
    pluginDirectory: 'plugins',
    context: dm,
    magiBaseUrl: MAGI_URL,
    magiToken: MAGI_TOKEN,
    updatedBy: alice.id,
  })
  updateCodingCredentials(
    contextId,
    'agent-provider',
    { agent: 'claude', provider: 'anthropic', provider_api_key: PROVIDER_KEY },
    alice.id,
  )
  upsertRepo(
    contextId,
    {
      name: 'papai',
      repoUrl: 'https://github.com/acme/papai.git',
      baseBranch: 'main',
      permissionPreset: 'cautious',
    },
    alice.id,
  )
  const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
  magi.expectStartSession({
    id: 'session-1',
    expected: { contextId, project: 'papai', prompt: 'Add health check', agent: 'claude' },
  })
  given.llm([
    callCapability('coding-session.start', { project: 'papai', prompt: 'Add health check' }),
    answer('Session started: https://papai.invalid/t/share-session-1'),
  ])

  await when.message(alice, dm, 'Add a health check to papai')

  then.replyTo(alice).equals('Session started: https://papai.invalid/t/share-session-1')
  const wire = world.runtime.resolveToolCapability('coding-session.start')
  expect(wire).toBeString()
  expect(world.model.inspections().some(({ availableTools }) => availableTools.includes(wire))).toBe(true)
  const record = getCodingSessionRecord(contextId, 'session-1')
  expect(record?.project).toBe('papai')
  expect(record?.title).toBe('Add health check')
  expect(record?.shareToken).toBe('share-session-1')
  expect(record?.transcriptUrl).toBe('https://papai.invalid/t/share-session-1')
  const trace = JSON.stringify(world.events.all())
  expect(trace).not.toContain(MAGI_TOKEN)
  expect(trace).not.toContain(PROVIDER_KEY)
  expect(trace).not.toContain('share-session-1')
  expect(world.events.all().find(({ kind }) => kind === 'magi.session.start')?.data).toEqual(
    expect.objectContaining({
      agent: 'claude-code-acp',
      contextId,
      hasPr: false,
      project: 'papai',
      status: 202,
    }),
  )
})
