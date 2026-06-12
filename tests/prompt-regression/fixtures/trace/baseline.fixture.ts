// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { TraceFixture } from '../../harness/fixture-types.js'

export const traceFixtures: readonly TraceFixture[] = [
  {
    kind: 'trace',
    meta: {
      id: 'trace-create-task-completes',
      description: 'A clear create-task request completes with create_task and a confirmation reply.',
      ownerArea: 'orchestration',
      roadmapPhase: 'phase-0',
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['create_task'] },
    script: [
      {
        type: 'tool_call',
        toolName: 'create_task',
        toolCallId: 'call-create',
        input: { title: 'Ship prompt harness' },
        output: { id: 'task-1', title: 'Ship prompt harness', url: 'https://tasks.test/task-1' },
      },
      { type: 'assistant_text', text: 'Created [Ship prompt harness](https://tasks.test/task-1).' },
    ],
    expected: {
      toolCalls: ['create_task'],
      finalClassification: 'completes_action',
      finalReplyMustContain: ['Created'],
    },
  },
  {
    kind: 'trace',
    meta: {
      id: 'trace-ambiguous-update-asks-clarification',
      description: 'Ambiguous task update asks one clarification question instead of mutating.',
      ownerArea: 'orchestration',
      roadmapPhase: 'phase-0',
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['search_tasks', 'update_task'] },
    script: [
      {
        type: 'tool_call',
        toolName: 'search_tasks',
        toolCallId: 'call-search',
        input: { query: 'auth bug' },
        output: { matches: [{ id: 't1' }, { id: 't2' }] },
      },
      { type: 'assistant_text', text: 'I found two matching tasks. Which one should I update?' },
    ],
    expected: {
      toolCalls: ['search_tasks'],
      forbiddenToolCalls: ['update_task'],
      finalClassification: 'asks_clarification',
      finalReplyMustContain: ['Which one'],
    },
  },
  {
    kind: 'trace',
    meta: {
      id: 'trace-destructive-confirmation-required',
      description: 'Low-confidence destructive action asks for confirmation.',
      ownerArea: 'tools',
      roadmapPhase: 'phase-0',
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['delete_task'] },
    script: [
      {
        type: 'tool_call',
        toolName: 'delete_task',
        toolCallId: 'call-delete',
        input: { taskId: 'task-1', confidence: 0.7 },
        output: { status: 'confirmation_required', message: 'Delete "Auth bug"?' },
      },
      { type: 'assistant_text', text: 'Delete "Auth bug"?' },
    ],
    expected: {
      toolCalls: ['delete_task'],
      finalClassification: 'asks_confirmation',
      finalReplyMustContain: ['Delete'],
    },
  },
  {
    kind: 'trace',
    meta: {
      id: 'trace-provider-error-retryable',
      description: 'Retryable provider error reports a retryable failure.',
      ownerArea: 'tools',
      roadmapPhase: 'phase-0',
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['list_tasks'] },
    script: [
      {
        type: 'tool_call',
        toolName: 'list_tasks',
        toolCallId: 'call-list',
        input: {},
        error: 'rate limited',
      },
      { type: 'assistant_text', text: 'The task tracker is rate-limiting me; let me try again in a moment.' },
    ],
    expected: {
      toolCalls: ['list_tasks'],
      finalClassification: 'reports_retryable_failure',
      finalReplyMustContain: ['try again'],
    },
  },
  {
    kind: 'trace',
    meta: {
      id: 'trace-stale-memory-conflict-prefers-current-user',
      description: 'Current user instruction should win over stale memory.',
      ownerArea: 'context',
      roadmapPhase: 'phase-0',
      pending: {
        reason: 'Current behavior needs stronger prompt/context assertions for stale memory conflict handling.',
        expectedFixPhase: 'phase-1',
        unskipWhen: 'Structured Prompt Surface Spec adds memory conflict fixtures and prompt rules.',
      },
    },
    setup: { contextType: 'dm', provider: 'kaneo', enabledTools: ['create_task'], memory: 'stale' },
    script: [{ type: 'assistant_text', text: 'Current user instruction wins over stale memory.' }],
    expected: {
      finalClassification: 'completes_action',
      finalReplyMustContain: ['Current user'],
    },
  },
]
