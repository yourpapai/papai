// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import { scenario } from '../harness/scenario.js'
import { answer, callCapability, promptTextFingerprint } from '../harness/scripted-llm.js'

scenario('SCN-instructions-save: saves a custom instruction and lists it', async ({ given, when, then, world }) => {
  const alice = given.user('alice')
  const dm = given.dm(alice)
  given.llm([
    callCapability('instructions.save', { text: 'Always reply in Spanish' }),
    answer('Saved that instruction.'),
  ])
  await when.message(alice, dm, 'Always reply to me in Spanish')
  then.replyTo(alice).equals('Saved that instruction.')

  given.llm([callCapability('instructions.list', {}), answer('Your instructions: Always reply in Spanish.')])
  await when.message(alice, dm, 'What instructions do you have?')
  then.replyTo(alice).contains('Always reply in Spanish')
  const last = world.model.inspections().at(-1)
  expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('Spanish'))
})

scenario(
  'SCN-instructions-list-delete: deletes an instruction and confirms it is gone from a later list',
  async ({ given, when, then, world }) => {
    const alice = given.user('alice')
    const dm = given.dm(alice)
    // Both instructions are seeded directly (not through a prior `list_instructions` turn) so the
    // deleted instruction's text never enters the scripted conversation history before deletion —
    // otherwise it would leak into the rule-3 fingerprint set via the earlier turn's real tool result.
    const seeded = given.instruction(dm, 'Never use emojis')
    given.instruction(dm, 'Always be concise')

    given.llm([callCapability('instructions.delete', { id: seeded.id }), answer('Deleted that instruction.')])
    await when.message(alice, dm, 'Delete the no-emoji rule')
    then.replyTo(alice).equals('Deleted that instruction.')

    given.llm([callCapability('instructions.list', {}), answer('You have one saved instruction: be concise.')])
    await when.message(alice, dm, 'List my instructions')
    then.replyTo(alice).contains('concise')
    const last = world.model.inspections().at(-1)
    expect(last?.promptToolResultTokenFingerprints).toContain(promptTextFingerprint('concise'))
    expect(last?.promptToolResultTokenFingerprints).not.toContain(promptTextFingerprint('emojis'))
  },
)
