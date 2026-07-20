// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { MATCH_EMBEDDING, expectEmbedding } from '../harness/embeddings.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario('SCN-memo-save: saves a note and reads it back on a later turn', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  // save_memo fires a fire-and-forget embed; settle drains it
  expectEmbedding(world.http)
  given.llm([
    callCapability('memos.save', {
      content: 'Deploy runbook lives in Notion',
      tags: ['ops'],
    }),
    answer('Saved your note about the deploy runbook.'),
  ])
  await when.message(alice, dm, 'Remember: deploy runbook lives in Notion')
  then.replyTo(alice).equals('Saved your note about the deploy runbook.')

  given.llm([callCapability('memos.list', {}), answer('Your notes: Deploy runbook lives in Notion.')])
  await when.message(alice, dm, 'What notes do I have?')
  then.replyTo(alice).contains('Deploy runbook')
  const last = world.model.inspections().at(-1)
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('Notion'))
})

scenario('SCN-memo-recall: recalls a saved note by semantic search', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  // Memo tools key personal notes by the group-scoped storage owner id (ADR-0201), not the
  // raw chat user id — seed under the same id `save_memo`/`search_memos` would use for this DM.
  given.memo({
    userId: world.scopedStorageContextId(dm),
    content: 'Deploy runbook lives in Notion',
    tags: ['ops'],
    embedding: MATCH_EMBEDDING,
  })
  // the query embed
  expectEmbedding(world.http, MATCH_EMBEDDING)
  given.llm([
    callCapability('memos.search', {
      query: 'where is the deploy runbook',
      mode: 'semantic',
    }),
    answer('Your deploy runbook lives in Notion.'),
  ])
  await when.message(alice, dm, 'Where did I put the deploy runbook?')
  then.replyTo(alice).contains('Notion')
  const last = world.model.inspections().at(-1)
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('runbook'))
})

scenario(
  'SCN-memo-archive: archives notes by id and excludes them from active list',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    const storageOwnerId = world.scopedStorageContextId(dm)
    const stale = given.memo({ userId: storageOwnerId, content: 'Old standup link' })
    given.memo({ userId: storageOwnerId, content: 'Current sprint goals' })
    given.llm([callCapability('memos.archive', { memoIds: [stale.id], confidence: 0.9 }), answer('Archived 1 note.')])
    await when.message(alice, dm, 'Archive the old standup note')
    then.replyTo(alice).equals('Archived 1 note.')

    given.llm([callCapability('memos.list', { status: 'active' }), answer('Active notes: Current sprint goals.')])
    await when.message(alice, dm, 'List my active notes')
    then.replyTo(alice).contains('Current sprint goals')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('sprint'))
    expect(last?.promptToolResultTokenFingerprints).not.toContain(promptTextFingerprint('standup'))
  },
)

scenario('SCN-memo-promote: promotes a note into a task', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  const instance = given.taskInstance()
  given.assign(dm, instance)
  const memo = given.memo({
    userId: world.scopedStorageContextId(dm),
    content: 'Write the incident postmortem',
  })
  given.llm([
    callCapability('memos.promote', {
      memoId: memo.id,
      projectId: 'proj-1',
      title: 'Write the incident postmortem',
    }),
    answer('Promoted your note to a task.'),
  ])
  await when.message(alice, dm, 'Turn that note into a task')
  then.replyTo(alice).equals('Promoted your note to a task.')
  await then.task('Write the incident postmortem').exists()
})
