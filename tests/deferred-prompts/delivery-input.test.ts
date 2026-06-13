// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { buildDeliveryInput, type CreateDeliveryContext } from '../../src/deferred-prompts/delivery-input.js'

const groupCtx: CreateDeliveryContext = {
  userId: 'creator-1',
  storageContextId: '-1001:42',
  contextType: 'group',
  username: 'creator',
}

describe('buildDeliveryInput', () => {
  test('DM context ignores policy and targets the user directly', () => {
    const target = buildDeliveryInput(
      { userId: 'user-1', storageContextId: 'user-1', contextType: 'dm' },
      { mention_user_ids: [] },
    )

    expect(target.contextType).toBe('dm')
    expect(target.contextId).toBe('user-1')
    expect(target.mentionUserIds).toEqual([])
  })

  test('group with omitted mention list defaults to @mentioning the requester (personal)', () => {
    const target = buildDeliveryInput(groupCtx, undefined)

    expect(target.contextType).toBe('group')
    expect(target.contextId).toBe('-1001')
    expect(target.threadId).toBe('42')
    expect(target.audience).toBe('personal')
    expect(target.mentionUserIds).toEqual(['creator-1'])
  })

  test('group with empty mention list is shared with no @mention', () => {
    const target = buildDeliveryInput(groupCtx, { mention_user_ids: [] })

    expect(target.audience).toBe('shared')
    expect(target.mentionUserIds).toEqual([])
  })

  test('group with explicit mention list is personal and uses the list verbatim', () => {
    const target = buildDeliveryInput(groupCtx, { mention_user_ids: ['creator-1', 'teammate-2'] })

    expect(target.audience).toBe('personal')
    expect(target.mentionUserIds).toEqual(['creator-1', 'teammate-2'])
  })
})
