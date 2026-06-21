// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import type { ChatParticipantResolver } from '../../../src/chat/participants/roster.js'
import { buildProviderlessToolDescriptors, makeTools } from '../../../src/tools/index.js'
import { createMockProvider } from '../../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('chatParticipantResolver plumbing through MakeToolsOptions', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('resolve_chat_participant absent when chatParticipantResolver not in options', async () => {
    const provider = createMockProvider()
    const tools = await makeTools(provider, {
      storageContextId: 'ctx-group',
      chatUserId: 'u1',
      contextType: 'group',
    })
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })

  test('resolve_chat_participant present when chatParticipantResolver provided and contextType=group', async () => {
    const provider = createMockProvider()
    const fakeResolver: ChatParticipantResolver = () => Promise.resolve([])
    const tools = await makeTools(provider, {
      storageContextId: 'ctx-group',
      chatUserId: 'u1',
      contextType: 'group',
      chatParticipantResolver: fakeResolver,
    })
    expect(tools['resolve_chat_participant']).toBeDefined()
  })

  test('resolve_chat_participant absent in dm context', async () => {
    const provider = createMockProvider()
    const fakeResolver: ChatParticipantResolver = () => Promise.resolve([])
    const tools = await makeTools(provider, {
      storageContextId: 'ctx-dm',
      chatUserId: 'u1',
      contextType: 'dm',
      chatParticipantResolver: fakeResolver,
    })
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })
})

describe('chatParticipantResolver plumbing through buildProviderlessToolDescriptors', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('resolve_chat_participant absent when chatParticipantResolver not provided (providerless group)', async () => {
    const tools = await buildProviderlessToolDescriptors({
      storageContextId: 'ctx-providerless-group',
      chatUserId: 'u1',
      contextType: 'group',
    })
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })

  test('resolve_chat_participant present when chatParticipantResolver provided and contextType=group (providerless)', async () => {
    const fakeResolver: ChatParticipantResolver = () => Promise.resolve([])
    const tools = await buildProviderlessToolDescriptors({
      storageContextId: 'ctx-providerless-group',
      chatUserId: 'u1',
      contextType: 'group',
      chatParticipantResolver: fakeResolver,
    })
    expect(tools['resolve_chat_participant']).toBeDefined()
  })

  test('resolve_chat_participant absent in dm context (providerless)', async () => {
    const fakeResolver: ChatParticipantResolver = () => Promise.resolve([])
    const tools = await buildProviderlessToolDescriptors({
      storageContextId: 'ctx-providerless-dm',
      chatUserId: 'u1',
      contextType: 'dm',
      chatParticipantResolver: fakeResolver,
    })
    expect(tools['resolve_chat_participant']).toBeUndefined()
  })
})
