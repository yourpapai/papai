// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { getContextSettings } from '../../../src/instances/context-store.js'
import { scenario } from '../harness/scenario.js'
import { answer, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario('group threads share config but isolate conversation history', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const group = given.group('release-team')
  given.member(group, alice)
  const threadA = given.thread(group, 'thread-a')
  const threadB = given.thread(group, 'thread-b')
  const taskInstance = given.taskInstance()
  given.assign(threadA, taskInstance)
  given.llm([answer('THREAD_A_ASSISTANT_ONLY'), answer('THREAD_B_ASSISTANT_ONLY')])

  await when.message(alice, threadA, 'THREAD_A_ONLY_MARKER')
  then.replyIn(threadA).equals('THREAD_A_ASSISTANT_ONLY')
  await when.message(alice, threadB, 'THREAD_B_ONLY_MARKER')
  then.replyIn(threadB).equals('THREAD_B_ASSISTANT_ONLY')

  const scopedGroupId = toScopedContextId({
    platformInstanceId: group.platformInstanceId,
    nativeContextId: group.id,
  })
  expect(getContextSettings(scopedGroupId)?.taskInstanceId).toBe(taskInstance.id)
  const secondThreadPrompt = world.model.inspections().at(-1)?.promptTokenFingerprints ?? []
  expect(secondThreadPrompt).toContain(promptTextFingerprint('THREAD_B_ONLY_MARKER'))
  expect(secondThreadPrompt).not.toContain(promptTextFingerprint('THREAD_A_ONLY_MARKER'))
  expect(secondThreadPrompt).not.toContain(promptTextFingerprint('THREAD_A_ASSISTANT_ONLY'))
})
