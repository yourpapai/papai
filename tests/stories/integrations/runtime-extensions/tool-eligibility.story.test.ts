// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { configureCodingSessionCapability } from '../../../../src/coding-sessions/configure.js'
import { createFakeMagi } from '../../harness/fake-magi.js'
import { scenario } from '../../harness/scenario.js'
import { answer, callCapability } from '../../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-runtime-extension-magi-token'
const ACP_AGENTS_CAPABILITY = 'coding-session.agents.list'

scenario(
  'runtime extension ACP tool is offered and executed only in its eligible context',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const aliceDm = given.dm(alice)
    const bobDm = given.dm(bob)
    const aliceContextId = toScopedContextId({
      platformInstanceId: alice.platformInstanceId,
      nativeContextId: alice.id,
    })
    const magi = createFakeMagi({ http: world.http, events: world.events, baseUrl: MAGI_URL, token: MAGI_TOKEN })
    magi.expectAgents([{ id: 'claude', name: 'Claude' }])
    given.runtimeExtension({
      start({ record }): void {
        configureCodingSessionCapability({
          pluginDirectory: 'plugins',
          contextId: aliceContextId,
          magiBaseUrl: MAGI_URL,
          magiToken: MAGI_TOKEN,
          updatedBy: alice.id,
        })
        record('scenario.runtime-extension.configured', { capability: ACP_AGENTS_CAPABILITY, context: 'alice' })
      },
    })
    given.llm([callCapability(ACP_AGENTS_CAPABILITY, {}), answer('Claude is available.')])

    await when.message(alice, aliceDm, 'Which coding agents are available?')

    then.replyTo(alice).equals('Claude is available.')
    const wire = world.runtime.resolveToolCapability(ACP_AGENTS_CAPABILITY)
    expect(world.model.inspections().some(({ availableTools }) => availableTools.includes(wire))).toBe(true)
    expect(world.events.all().some(({ kind }) => kind === 'http.request')).toBe(true)
    expect(world.events.all().some(({ kind }) => kind === 'scenario.runtime-extension.configured')).toBe(true)

    const beforeBob = world.model.inspections().length
    given.llm([answer('ACP is unavailable in this context.')])

    await when.message(bob, bobDm, 'Which coding agents are available?')

    then.replyTo(bob).equals('ACP is unavailable in this context.')
    const bobInspections = world.model.inspections().slice(beforeBob)
    expect(bobInspections).not.toHaveLength(0)
    expect(bobInspections.every(({ availableTools }) => !availableTools.includes(wire))).toBe(true)
    expect(world.events.all().filter(({ kind }) => kind === 'http.request')).toHaveLength(1)
  },
)
