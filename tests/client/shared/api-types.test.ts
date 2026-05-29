// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type {
  Fact,
  Instruction,
  Session,
  Wizard,
  SchedulerInfo,
  PollersInfo,
  MessageCacheInfo,
  TokenInfo,
  ToolCall,
  Turn,
  Notification,
  ToolFailure,
  RecurringTask,
  DeferredPrompt,
  Memo,
  IdentityMappingEntry,
  AuthorizedGroupEntry,
  BillingWindow,
  BillingRoleTotals,
  BillingSubject,
  BillingRequestRow,
  BillingDetail,
  AdminLlmKeyState,
  AdminLlmSnapshot,
} from '../../../client/shared/api-types.js'

describe('api-types', () => {
  test('types compile successfully and are correct', () => {
    // Construct minimal type compliant variables to verify compiler accepts them
    const fact: Fact = {
      identifier: 'id1',
      title: 'Fact Title',
      url: 'http://example.com',
      lastSeen: '2026-05-21T00:00:00.000Z',
    }

    const instruction: Instruction = {
      id: 'inst1',
      text: 'do task',
      createdAt: '2026-05-21T00:00:00.000Z',
    }

    const session: Session = {
      userId: 'user123',
      lastAccessed: 123456789,
      historyLength: 10,
      factsCount: 5,
      summary: null,
      configKeys: ['llm_apikey'],
    }

    const wizard: Wizard = {
      userId: 'user123',
      currentStep: 1,
      totalSteps: 3,
    }

    const schedulerInfo: SchedulerInfo = {
      running: true,
      tickCount: 42,
    }

    const pollersInfo: PollersInfo = {
      scheduledRunning: false,
      alertsRunning: true,
    }

    const messageCacheInfo: MessageCacheInfo = {
      size: 5,
      pendingWrites: 0,
    }

    const tokenInfo: TokenInfo = {
      inputTokens: 1000,
      outputTokens: 500,
    }

    const toolCall: ToolCall = {
      toolName: 'create_task',
      durationMs: 150,
      success: true,
    }

    const turn: Turn = {
      turnId: 'turn1',
      scope: {
        kind: 'user',
        userId: 'user123',
      },
      startedAt: 1234567890,
      status: 'ok',
      incomingMessageCount: 1,
      toolCalls: [
        {
          name: 'create_task',
          durationMs: 100,
          ok: true,
        },
      ],
    }

    const notification: Notification = {
      timestamp: 1234567890,
      type: 'info',
      scope: {
        kind: 'user',
        userId: 'user123',
      },
      data: {
        message: 'hello',
      },
    }

    const toolFailure: ToolFailure = {
      timestamp: 1234567890,
      scope: {
        kind: 'user',
        userId: 'user123',
      },
      data: {
        toolName: 'create_task',
        error: 'failed',
      },
    }

    const recurringTask: RecurringTask = {
      id: 'rec1',
      userId: 'user123',
      title: 'Daily report',
      rrule: 'FREQ=DAILY',
      nextRun: '2026-05-22T00:00:00.000Z',
      enabled: true,
      lastRun: null,
    }

    const deferredPrompt: DeferredPrompt = {
      id: 'def1',
      createdByUserId: 'user123',
      prompt: 'Follow up',
      fireAt: '2026-05-22T10:00:00.000Z',
      rrule: null,
      status: 'pending',
    }

    const memo: Memo = {
      id: 'memo1',
      userId: 'user123',
      content: 'Important info',
      summary: 'Info',
      tags: ['personal'],
      status: 'active',
      createdAt: '2026-05-21T00:00:00.000Z',
      updatedAt: '2026-05-21T00:00:00.000Z',
    }

    const identityMapping: IdentityMappingEntry = {
      contextId: 'user123',
      providerName: 'kaneo',
      providerUserId: 'pk123',
      providerUserLogin: 'pk_user',
      displayName: 'PK User',
      matchedAt: '2026-05-21T00:00:00.000Z',
      matchMethod: 'auto',
      confidence: 0.95,
    }

    const authorizedGroup: AuthorizedGroupEntry = {
      group_id: 'group123',
      added_by: 'user123',
      added_at: '2026-05-21T00:00:00.000Z',
    }

    const billingWindow: BillingWindow = '30d'

    const billingTotals: BillingRoleTotals = {
      inputTokens: 25000,
      outputTokens: 12000,
      calls: 15,
    }

    const billingSubject: BillingSubject = {
      storageContextId: 'ctx123',
      contextType: 'dm',
      displayName: 'DM Context',
      totals: {
        main: billingTotals,
        small: billingTotals,
        embedding: billingTotals,
      },
      toolCalls: 50,
      lastActiveAt: 123456789,
    }

    const billingRow: BillingRequestRow = {
      eventId: 'evt1',
      occurredAt: 1234567890,
      turnId: null,
      chatUserId: 'user123',
      model: 'gpt-4o',
      modelRole: 'main',
      inputTokens: 1500,
      outputTokens: 600,
      stepCount: 1,
      toolCallCount: 2,
      messageCount: 2,
      durationMs: 400,
      finishReason: 'stop',
      error: null,
    }

    const billingDetail: BillingDetail = {
      subject: billingSubject,
      requests: [billingRow],
      truncated: false,
    }

    const keyState: AdminLlmKeyState = {
      value: 'sk-proj-...',
      updatedAt: 123456789,
      updatedBy: 'user123',
    }

    const llmSnapshot: AdminLlmSnapshot = {
      llm_apikey: keyState,
      llm_baseurl: keyState,
      main_model: keyState,
      small_model: keyState,
      embedding_model: keyState,
    }

    // Assert true to prove it compiles and runs without issues
    expect(fact.identifier).toBe('id1')
    expect(instruction.id).toBe('inst1')
    expect(session.userId).toBe('user123')
    expect(wizard.userId).toBe('user123')
    expect(schedulerInfo.running).toBe(true)
    expect(pollersInfo.alertsRunning).toBe(true)
    expect(messageCacheInfo.size).toBe(5)
    expect(tokenInfo.inputTokens).toBe(1000)
    expect(toolCall.toolName).toBe('create_task')
    expect(turn.turnId).toBe('turn1')
    expect(notification.timestamp).toBe(1234567890)
    expect(toolFailure.timestamp).toBe(1234567890)
    expect(recurringTask.id).toBe('rec1')
    expect(deferredPrompt.id).toBe('def1')
    expect(memo.id).toBe('memo1')
    expect(identityMapping.contextId).toBe('user123')
    expect(authorizedGroup.group_id).toBe('group123')
    expect(billingWindow).toBe('30d')
    expect(billingTotals.calls).toBe(15)
    expect(billingSubject.storageContextId).toBe('ctx123')
    expect(billingRow.eventId).toBe('evt1')
    expect(billingDetail.truncated).toBe(false)
    expect(llmSnapshot.llm_apikey.value).toBe('sk-proj-...')
  })
})
