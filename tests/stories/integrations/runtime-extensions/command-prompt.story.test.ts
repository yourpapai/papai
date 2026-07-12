// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../../src/chat/scoped-context.js'
import { configureCodingSessionCapability } from '../../../../src/coding-sessions/configure.js'
import { scenario } from '../../harness/scenario.js'
import { answer, promptTextFingerprint } from '../../harness/scripted-llm.js'

const MAGI_URL = 'https://magi.invalid'
const MAGI_TOKEN = 'scenario-runtime-extension-magi-token'
const ACP_PROMPT_MARKER = 'sandboxed'
const ACP_COMMAND = '/plugin_acp_acp'
const ACP_COMMAND_REPLY =
  'ACP coding sessions are available. Ask me in natural language, e.g. "start a session on demo to add a ' +
  'health check", "what sessions are running?", "review PR 42 on demo", or "continue PR 42 on demo and fix ' +
  'the failing tests".'

scenario(
  'runtime extension ACP command and prompt are hidden outside its configured context',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const bob = given.user('bob')
    const aliceDm = given.dm(alice)
    const bobDm = given.dm(bob)
    const aliceContextId = toScopedContextId({
      platformInstanceId: alice.platformInstanceId,
      nativeContextId: alice.id,
    })
    given.runtimeExtension({
      start({ record }): void {
        configureCodingSessionCapability({
          pluginDirectory: 'plugins',
          contextId: aliceContextId,
          magiBaseUrl: MAGI_URL,
          magiToken: MAGI_TOKEN,
          updatedBy: alice.id,
        })
        record('scenario.runtime-extension.configured', { contribution: 'command-and-prompt', context: 'alice' })
      },
    })

    await when.message(alice, aliceDm, ACP_COMMAND)

    then.replyTo(alice).equals(ACP_COMMAND_REPLY)
    given.llm([answer('I can help with ACP.')])
    await when.message(alice, aliceDm, 'Tell me about coding sessions')
    then.replyTo(alice).equals('I can help with ACP.')
    expect(world.model.inspections().at(-1)?.promptTokenFingerprints).toContain(
      promptTextFingerprint(ACP_PROMPT_MARKER),
    )

    const beforeBob = world.model.inspections().length
    given.llm([answer('No ACP contribution is available here.')])
    await when.message(bob, bobDm, 'Tell me about coding sessions')

    then.replyTo(bob).equals('No ACP contribution is available here.')
    const bobInspections = world.model.inspections().slice(beforeBob)
    expect(bobInspections).not.toHaveLength(0)
    expect(
      bobInspections.every(
        ({ promptTokenFingerprints }) => !promptTokenFingerprints.includes(promptTextFingerprint(ACP_PROMPT_MARKER)),
      ),
    ).toBe(true)
  },
)
