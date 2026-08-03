// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { classifyEdit } from '../../src/message-edit/classify.js'
import type { LastTurn } from '../../src/run-control/last-turn-registry.js'
import { RunRegistry } from '../../src/run-control/registry.js'
import type { RunControl } from '../../src/run-control/types.js'
import { createMockReply } from '../utils/test-helpers.js'

let runSeq = 0
function makeRun(originatingMessageIds: readonly string[]): RunControl {
  const { reply } = createMockReply()
  const contextId = `ctx-${++runSeq}`
  return new RunRegistry().begin(contextId, { turnId: 't', reply, originatingMessageIds })
}

function makeLastTurn(originatingMessageIds: readonly string[]): LastTurn {
  return { originatingMessageIds, completedEffects: [], replyTarget: undefined, finishedAt: 0 }
}

describe('classifyEdit', () => {
  it('W1 when edit is the active run origin', () => {
    expect(
      classifyEdit({
        editedMessageId: 'm1',
        activeRun: makeRun(['m1']),
        lastTurn: undefined,
        laterUserMessageExists: false,
      }),
    ).toBe('w1')
  })
  it('W3 when active run exists but edit is not its origin', () => {
    expect(
      classifyEdit({
        editedMessageId: 'm9',
        activeRun: makeRun(['m1']),
        lastTurn: undefined,
        laterUserMessageExists: false,
      }),
    ).toBe('w3')
  })
  it('W2 when last turn origin and no later user message', () => {
    expect(
      classifyEdit({
        editedMessageId: 'm1',
        activeRun: undefined,
        lastTurn: makeLastTurn(['m1']),
        laterUserMessageExists: false,
      }),
    ).toBe('w2')
  })
  it('W3 when last turn origin but a later user message exists', () => {
    expect(
      classifyEdit({
        editedMessageId: 'm1',
        activeRun: undefined,
        lastTurn: makeLastTurn(['m1']),
        laterUserMessageExists: true,
      }),
    ).toBe('w3')
  })
  it('W3 when neither active run nor last turn match', () => {
    expect(
      classifyEdit({ editedMessageId: 'm1', activeRun: undefined, lastTurn: undefined, laterUserMessageExists: false }),
    ).toBe('w3')
  })
})
