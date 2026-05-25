// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { addAuthorizedGroup } from '../src/authorized-groups.js'
import { maybeInterceptWizard } from '../src/bot-settings.js'
import { toScopedContextId } from '../src/chat/scoped-context.js'
import { upsertGroupAdminObservation, upsertKnownGroupContext } from '../src/group-settings/registry.js'
import { createGroupSettingsSession } from '../src/group-settings/state.js'
import { createAuth, createDmMessage, createMockReply, mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('bot settings interception', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('keeps already-scoped active group target valid for already-scoped known group contexts', async () => {
    const scopedGroupId = toScopedContextId({ platformInstanceId: 'telegram-default', nativeContextId: 'group-123' })
    upsertKnownGroupContext({
      contextId: scopedGroupId,
      provider: 'telegram',
      displayName: 'Engineering',
      parentName: null,
    })
    upsertGroupAdminObservation({
      contextId: scopedGroupId,
      provider: 'telegram',
      userId: 'admin1',
      username: 'admin1',
      isAdmin: true,
    })
    addAuthorizedGroup(scopedGroupId, 'admin1')
    createGroupSettingsSession({
      userId: 'admin1',
      command: 'setup',
      stage: 'active',
      targetContextId: scopedGroupId,
    })
    const message = createDmMessage('admin1')
    message.platformInstanceId = 'telegram-default'
    message.text = 'hello'
    const { reply, textCalls } = createMockReply()
    const autoStartTargets: string[] = []

    const handled = await maybeInterceptWizard(
      message,
      reply,
      createAuth('admin1', { isBotAdmin: true }),
      false,
      (_userId, storageContextId) => {
        autoStartTargets.push(storageContextId)
        return Promise.resolve(false)
      },
    )

    expect(handled).toBe(false)
    expect(textCalls).toEqual([])
    expect(autoStartTargets).toEqual([scopedGroupId])
  })
})
