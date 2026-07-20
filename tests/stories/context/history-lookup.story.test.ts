// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario('SCN-history-lookup: searches the main group history from a thread', async ({ given, when, then, world }) => {
  const g1 = given.group('g1')
  const alice = given.user('alice')
  given.member(g1, alice)
  const thread = given.thread(g1, 'thread-1')

  // Seed the MAIN group history (threadId undefined). `g1` (the GroupHandle, not the thread) resolves
  // to the same storage id `lookup_group_history` reads via `getMainContextIdFromThreadContextId`.
  given.dirtyContext(g1, {
    messages: [
      { role: 'user', content: 'Bob: the launch date moved to March 3rd' },
      { role: 'user', content: 'Alice: thanks, updating the calendar' },
    ],
    lastActivityAt: '2026-07-19T00:00:00.000Z',
  })

  // lookup_group_history runs its own extraction generation through getSmallModel/generateText,
  // which hits the real openai-compatible chat-completions endpoint (not the scripted world model).
  world.http.expect({ method: 'POST', url: 'https://llm.invalid/v1/chat/completions' }, () =>
    Response.json({
      id: 'chatcmpl-lookup-1',
      choices: [
        {
          message: { role: 'assistant', content: 'The launch date moved to March 3rd.' },
          finish_reason: 'stop',
        },
      ],
    }),
  )

  given.llm([
    callCapability('history.lookup', { queries: ['launch date'] }),
    answer('The launch date moved to March 3rd.'),
  ])
  await when.message(alice, thread, 'What did the group say about the launch date?')
  then.replyIn(thread).contains('March 3rd')
  const last = world.model.inspections().at(-1)
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('March'))
})
