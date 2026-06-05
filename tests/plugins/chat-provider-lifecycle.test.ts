// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  deactivateContributedChatProviderTypes,
  unregisterContributedChatProviderTypes,
} from '../../src/plugins/chat-provider-lifecycle.js'

describe('unregisterContributedChatProviderTypes', () => {
  test('returns empty array when no types registered', () => {
    const result = unregisterContributedChatProviderTypes('nonexistent-plugin')
    expect(result).toEqual([])
  })
})

describe('deactivateContributedChatProviderTypes', () => {
  test('returns empty array when no types registered', () => {
    const result = deactivateContributedChatProviderTypes('nonexistent-plugin')
    expect(result).toEqual([])
  })
})
