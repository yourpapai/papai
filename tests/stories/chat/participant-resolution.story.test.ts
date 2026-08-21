// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { toScopedContextId } from '../../../src/chat/scoped-context.js'
import { scheduledPrompts } from '../../../src/db/deferred-schema.js'
import { getDrizzleDb } from '../../../src/db/drizzle.js'
import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

/** Position of a token inside the serialized tool result, which preserves candidate order. */
const rank = (fingerprints: readonly string[] | undefined, text: string): number =>
  fingerprints?.indexOf(promptTextFingerprint(text)) ?? -1

scenario(
  'SCN-chat-participant-ranking: ranks group members and recent senders exact before prefix before substring',
  async ({ given, when, then, world }) => {
    const group = given.group('release-team')
    const asker = given.user('u-asker')
    given.member(group, asker)
    given.guestMode(group, true)

    const exact = given.user('u-alpha')
    const prefix = given.user('u-bravo')
    const substring = given.user('u-charlie')
    const unmatched = given.user('u-delta')
    for (const member of [exact, prefix, substring, unmatched]) given.member(group, member)
    given.chatUserLabel(exact, 'Ann')
    given.chatUserLabel(prefix, 'Annabel')
    given.chatUserLabel(substring, 'Rosanna')
    given.chatUserLabel(unmatched, 'Boris')

    // A guest is never provisioned as a member, so this sender reaches the roster only
    // through message_metadata — the other half of the union gatherParticipants takes.
    // It must speak in `group` itself: message_metadata is keyed by the thread-scoped
    // storage context id, so a sibling thread would seed a row the resolver never reads.
    const sender = given.guest('u-echo')
    given.chatUserLabel(sender, 'Annika')
    given.llm([answer('Welcome.')])
    await when.message(sender, group, 'hello team')

    given.llm([
      callCapability('chat.participants.resolve', { query: 'ann' }),
      // The resolved id is what the tool exists for: it must survive into the
      // reminder's delivery policy, not merely be reported back to the model.
      callCapability('deferred.create', {
        prompt: 'Ask Ann for the release notes',
        schedule: { fire_at: { date: '2099-01-01', time: '09:00' } },
        execution: { mode: 'lightweight', delivery_brief: 'nudge about release notes' },
        delivery: { mention_user_ids: [exact.id] },
      }),
      answer('Ann is the closest match.'),
    ])
    await when.message(asker, group, 'Who around here is called Ann? Remind us on Jan 1 to ask them.')

    then.replyIn(group).equals('Ann is the closest match.')
    // A group reminder is owned by the group context, not by the member who asked for it.
    const groupContextId = toScopedContextId({
      platformInstanceId: group.platformInstanceId,
      nativeContextId: group.id,
    })
    const scheduled = getDrizzleDb().select().from(scheduledPrompts).all()
    expect(scheduled.map(({ createdByUserId, mentionUserIds }) => ({ createdByUserId, mentionUserIds }))).toEqual([
      // A group reminder is owned by the group context, not by the member who asked for it.
      { createdByUserId: groupContextId, mentionUserIds: JSON.stringify([exact.id]) },
    ])
    const result = world.model.inspections().at(-1)?.promptToolResultTokenFingerprints
    expect(rank(result, 'Ann')).toBeGreaterThanOrEqual(0)
    expect(rank(result, 'Ann')).toBeLessThan(rank(result, 'Annabel'))
    expect(rank(result, 'Annabel')).toBeLessThan(rank(result, 'Annika'))
    expect(rank(result, 'Annika')).toBeLessThan(rank(result, 'Rosanna'))
    expect(rank(result, 'Boris')).toBe(-1)
  },
)

scenario(
  'SCN-chat-participant-label-fallback: an unresolvable label falls back to the identifier without failing the turn',
  async ({ given, when, then, world }) => {
    const group = given.group('support-rota')
    const asker = given.user('u-asker')
    given.member(group, asker)

    const labelled = given.user('u-labelled')
    const plain = given.user('quill-plain')
    const failing = given.user('quill-failing')
    for (const member of [labelled, plain, failing]) given.member(group, member)
    given.chatUserLabel(labelled, 'Quill')
    // roster.ts catches a failing label lookup and falls back rather than failing the turn.
    given.chatUserLabel(failing, new Error('platform lookup failed'))
    // `plain` is seeded with no label at all: the provider reports the id as unknown.
    // Scenario usernames equal user ids, so the username and userId fallbacks are the same
    // string here; roster.test.ts separates them where the two can actually differ.

    given.llm([callCapability('chat.participants.resolve', { query: 'quill' }), answer('Three people match Quill.')])
    await when.message(asker, group, 'Who matches quill?')

    then.replyIn(group).equals('Three people match Quill.')
    const result = world.model.inspections().at(-1)?.promptToolResultTokenFingerprints
    // Exact label first; the two identifier fallbacks tie on score and break by userId.
    expect(rank(result, 'Quill')).toBeGreaterThanOrEqual(0)
    expect(rank(result, 'Quill')).toBeLessThan(rank(result, 'failing'))
    expect(rank(result, 'failing')).toBeLessThan(rank(result, 'plain'))
  },
)

scenario(
  'SCN-chat-participant-dm-absent: the resolver tool is offered in a group turn and withheld in a DM turn',
  async ({ given, when, then, world }) => {
    const asker = given.user('u-asker')
    const group = given.group('release-team')
    given.member(group, asker)
    const dm = given.dm(asker)

    // The DM turn runs first on purpose: the capability catalog accumulates across the
    // turns of a process, so only a turn that precedes every group turn can witness the
    // absence. `contextType === 'group'` is the one denial surface reachable from
    // production wiring — the other two conjuncts of the gate at
    // src/tools/tools-builder.ts:270 (a defined resolver, a defined contextId) are always
    // satisfied there.
    given.llm([answer('Asked in a DM.')])
    await when.message(asker, dm, 'anything')
    then.replyIn(dm).equals('Asked in a DM.')
    expect(() => world.runtime.resolveToolCapability('chat.participants.resolve')).toThrow(
      "Unknown tool capability id 'chat.participants.resolve'",
    )

    given.llm([answer('Asked in the group.')])
    await when.message(asker, group, 'anything')

    then.replyIn(group).equals('Asked in the group.')
    expect(world.runtime.resolveToolCapability('chat.participants.resolve')).toBe('resolve_chat_participant')
  },
)
