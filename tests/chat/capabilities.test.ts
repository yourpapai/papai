// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { supportsCommandMenu, supportsFileReplies } from '../../src/chat/capabilities.js'
import type { ChatCapability } from '../../src/chat/types.js'

const allCapabilities = new Set<ChatCapability>([
  'messages.buttons',
  'interactions.callbacks',
  'messages.files',
  'users.resolve',
  'commands.menu',
])

const withCapabilities = (caps: ChatCapability[]): { capabilities: Set<ChatCapability> } => ({
  capabilities: new Set<ChatCapability>(caps),
})

describe('chat capability helpers', () => {
  test('supportsFileReplies returns true when messages.files is present', () => {
    expect(supportsFileReplies({ capabilities: allCapabilities })).toBe(true)
  })

  test('supportsFileReplies returns false when messages.files is absent', () => {
    expect(supportsFileReplies(withCapabilities(['messages.buttons']))).toBe(false)
  })

  test('supportsCommandMenu returns true when commands.menu is present', () => {
    expect(supportsCommandMenu({ capabilities: allCapabilities })).toBe(true)
  })

  test('supportsCommandMenu returns false when commands.menu is absent', () => {
    expect(supportsCommandMenu(withCapabilities(['messages.buttons']))).toBe(false)
  })
})
