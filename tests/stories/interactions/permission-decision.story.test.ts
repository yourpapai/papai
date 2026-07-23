// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ScenarioReply } from '../harness/chat.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability } from '../harness/scripted-llm.js'

type ReplyReader = Readonly<{
  chat: { allReplies(): readonly ScenarioReply[] }
}>

const permissionCallback = (world: ReplyReader, prefix: string, since: number): string | undefined =>
  world.chat
    .allReplies()
    .slice(since)
    .flatMap((reply) => {
      const options = reply.options
      if (typeof options !== 'object' || options === null || !('buttons' in options)) return []
      const { buttons } = options
      if (!Array.isArray(buttons)) return []
      const items: unknown[] = buttons
      return items.flatMap((button): string[] => {
        if (typeof button !== 'object' || button === null || !('callbackData' in button)) return []
        return typeof button.callbackData === 'string' ? [button.callbackData] : []
      })
    })
    .find((callbackData) => callbackData.startsWith(prefix))

const waitForPermissionCallback = async (world: ReplyReader, prefix: string): Promise<string | undefined> => {
  const since = world.chat.allReplies().length
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const callback = permissionCallback(world, prefix, since)
    if (callback !== undefined) return callback
    await new Promise((resolve) => {
      setImmediate(resolve)
    })
  }
  return undefined
}

const finalizationConfirmations = (world: ReplyReader): string[] =>
  world.chat
    .allReplies()
    .filter((reply) => reply.kind === 'ephemeral-confirm')
    .flatMap((reply) => (typeof reply.content === 'string' ? [reply.content] : []))

scenario(
  'SCN-interaction-permission-decision: routes an ask-gate callback and self-finalizes the prompt',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const instance = given.taskInstance()
    given.assign(dm, instance)
    given.toolPrefs(dm, {
      riskDefaults: {},
      domainDefaults: {},
      toolOverrides: { create_task: 'ask' },
    })

    // Allow arm: the routed perm:a callback resumes the deferred tool and self-finalizes the prompt.
    given.llm([
      callCapability('tasks.create', {
        projectId: 'proj-1',
        title: 'Approved',
        _permission_reason: 'creates a task',
      }),
      answer('Created “Approved”.'),
    ])
    await when.dispatchMessage(alice, dm, 'Create task Approved')
    const allowCallback = await waitForPermissionCallback(world, 'perm:a:')
    expect(allowCallback).toBeDefined()
    await when.interaction(alice, dm, allowCallback ?? '')

    then.replyTo(alice).equals('Created “Approved”.')
    await then.task('Approved').exists()
    expect(finalizationConfirmations(world)).toContain('Allowed create_task ✅')

    // Deny arm: the routed perm:d callback refuses the tool and self-finalizes the prompt.
    given.llm([
      callCapability('tasks.create', {
        projectId: 'proj-1',
        title: 'Refused',
        _permission_reason: 'creates a task',
      }),
      answer('I could not create “Refused” without your permission.'),
    ])
    await when.dispatchMessage(alice, dm, 'Create task Refused')
    const denyCallback = await waitForPermissionCallback(world, 'perm:d:')
    expect(denyCallback).toBeDefined()
    await when.interaction(alice, dm, denyCallback ?? '')

    then.replyTo(alice).equals('I could not create “Refused” without your permission.')
    await then.task('Refused').absent()
    expect(finalizationConfirmations(world)).toContain('Denied create_task 🚫')
  },
)
