// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { expectEmbedding } from '../harness/embeddings.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario('SCN-memory-remember: stores a durable memory and lists it', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([
    callCapability('memory.remember', { content: 'Prefers metric units', kind: 'preference' }),
    answer("Noted — I'll use metric units."),
  ])
  await when.message(alice, dm, 'Always use metric units with me')
  then.replyTo(alice).contains('metric')

  given.llm([callCapability('memory.list', {}), answer('I remember: prefers metric units.')])
  await when.message(alice, dm, 'What do you remember about me?')
  then.replyTo(alice).contains('metric')
  const last = world.model.inspections().at(-1)
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('metric'))
})

scenario('SCN-memory-recall: recalls a stored memory by keyword', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([callCapability('memory.remember', { content: 'Home airport is SFO', kind: 'fact' }), answer('Got it.')])
  await when.message(alice, dm, 'My home airport is SFO')
  then.replyTo(alice).equals('Got it.')

  // remember_memory writes no vector, so this record is keyword-only; search_memory still fires
  // one query embed unconditionally (config resolves), and the recall falls back to the FTS/keyword
  // layer since semantic ranking finds no candidate with a stored embedding.
  expectEmbedding(world.http)
  given.llm([callCapability('memory.search', { query: 'home airport' }), answer('Your home airport is SFO.')])
  await when.message(alice, dm, 'Which airport do I fly from?')
  then.replyTo(alice).contains('SFO')
  const last = world.model.inspections().at(-1)
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('SFO'))
})

scenario('SCN-memory-forget: forgets a stored memory by query', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([
    callCapability('memory.remember', { content: 'Old office is on 3rd street', kind: 'fact' }),
    answer('Noted.'),
  ])
  await when.message(alice, dm, 'My office is on 3rd street')
  then.replyTo(alice).equals('Noted.')

  // forget_memory resolves the target through a direct FTS lookup (searchMemoryRecords), not the
  // embedding-backed recall cascade, so no /embeddings call is expected here. The purge is
  // irreversible, so it also sits behind the confidence gate: 0.9 is the direct-unambiguous-command
  // band, which "Forget where my office is" falls in.
  given.llm([
    callCapability('memory.forget', { query: 'office is on 3rd street', confidence: 0.9 }),
    answer('Forgotten.'),
  ])
  await when.message(alice, dm, 'Forget where my office is')
  then.replyTo(alice).equals('Forgotten.')

  given.llm([callCapability('memory.list', {}), answer('I have no memories about your office.')])
  await when.message(alice, dm, 'What do you remember about my office?')
  then.replyTo(alice).contains('no memories')
  const last = world.model.inspections().at(-1)
  expect(last?.promptToolResultTokenFingerprints).not.toContain(promptTextFingerprint('street'))
})

scenario(
  'SCN-memory-capture-sweep: captures a memory from an idle group thread',
  async ({ given, when, then, world }) => {
    const g1 = given.group('g1')
    const alice = given.user('alice')
    given.member(g1, alice)
    const thread = given.thread(g1, 'thread-1')
    given.dirtyContext(thread, {
      messages: [{ role: 'user', content: 'We always cut releases on Fridays' }],
      lastActivityAt: '2026-07-19T00:00:00.000Z',
    })
    // captureSweep injects the record embed through the production DI seam (no /embeddings HTTP call).
    await when.captureSweep({
      records: [
        {
          kind: 'fact',
          content: 'Team cuts releases on Fridays',
          confidence: 0.7,
          tags: [],
        },
      ],
    })

    // the follow-up recall query embed
    expectEmbedding(world.http)
    given.llm([
      callCapability('memory.search', { query: 'when do we cut releases' }),
      answer('Your team cuts releases on Fridays.'),
    ])
    await when.message(alice, thread, 'When do we usually release?')
    then.replyIn(thread).contains('Fridays')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('Fridays'))
  },
)

scenario(
  'SCN-memory-promotion-sweep: promotes a cross-thread provisional cluster to durable',
  async ({ given, when, then, world }) => {
    const g1 = given.group('g1')
    const alice = given.user('alice')
    given.member(g1, alice)
    const scopeId = world.groupScopeId(g1)
    for (const threadContextId of ['thread-1', 'thread-2', 'thread-3']) {
      given.memoryRecord({
        scope: { scopeId, scopeType: 'group' },
        kind: 'fact',
        content: 'Team standup is at 10am',
        status: 'provisional',
        threadContextId,
      })
    }
    // promotionSweep injects confirmDurable -> true; it does not call an LLM or an embeddings endpoint.
    await when.promotionSweep()

    const mainThread = given.thread(g1, 'thread-9')
    given.llm([callCapability('memory.list', { status: 'active' }), answer('I durably remember: standup is at 10am.')])
    await when.message(alice, mainThread, 'What do you durably remember?')
    then.replyIn(mainThread).contains('10am')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('standup'))
  },
)
