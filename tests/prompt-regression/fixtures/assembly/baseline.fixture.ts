// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { AssemblyFixture } from '../../harness/fixture-types.js'

export const assemblyFixtures: readonly AssemblyFixture[] = [
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-dm-kaneo-normal-tools',
      description: 'DM with task provider includes core workflow and task guidance.',
      ownerArea: 'prompt',
      roadmapPhase: 'phase-0',
    },
    setup: {
      contextType: 'dm',
      provider: 'kaneo',
      enabledTools: ['create_task', 'update_task', 'web_fetch', 'save_instruction', 'delete_task'],
    },
    expected: {
      prompt: {
        mustContain: ['You are papai', '<current_time>', 'WORKFLOW:', 'DUE DATES', 'WEB FETCH'],
        mustNotContain: ['task tracker tools are unavailable'],
      },
      tools: {
        include: ['create_task', 'update_task', 'web_fetch'],
        exclude: ['delete_project'],
      },
    },
  },
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-providerless-dm',
      description: 'Providerless DM explains that task tracker tools are unavailable.',
      ownerArea: 'prompt',
      roadmapPhase: 'phase-0',
    },
    setup: {
      contextType: 'providerless',
      provider: 'providerless',
      enabledTools: ['web_fetch', 'get_current_time'],
    },
    expected: {
      prompt: {
        mustContain: ['task tracker tools are unavailable', 'must not pretend', '/config'],
        mustNotContain: ['create_task', 'update_task'],
      },
      tools: { include: ['web_fetch', 'get_current_time'], exclude: ['create_task'] },
    },
  },
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-ask-gated-tool-preference',
      description: 'Ask-gated tools are listed with _permission_reason requirements.',
      ownerArea: 'prompt',
      roadmapPhase: 'phase-0',
    },
    setup: {
      contextType: 'dm',
      provider: 'kaneo',
      enabledTools: ['delete_task', 'ask_permission'],
      askTools: ['delete_task'],
    },
    expected: {
      prompt: {
        mustContain: ['Some tools require user permission', '_permission_reason', 'delete_task'],
      },
      tools: { include: ['delete_task'], exclude: [] },
    },
  },
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-memory-trust-labels',
      description: 'Memory setup expects low-trust compact and long-term memory labels.',
      ownerArea: 'context',
      roadmapPhase: 'phase-0',
    },
    setup: {
      contextType: 'dm',
      provider: 'kaneo',
      enabledTools: ['create_task'],
      memory: 'compacted-and-long-term',
    },
    expected: {
      prompt: {
        mustContain: ['You are papai'],
      },
    },
  },
  {
    kind: 'assembly',
    meta: {
      id: 'assembly-tool-context-reduction-flags-on',
      description: 'Tool-context reduction flag-on prompt compatibility is tracked for later graduation.',
      ownerArea: 'tool-context-reduction',
      roadmapPhase: 'phase-0',
      pending: {
        reason: 'Flag-on disclosure behavior is already merged but needs dedicated graduation fixtures.',
        expectedFixPhase: 'phase-4',
        unskipWhen: 'Tool-Context Reduction Graduation Spec defines flag-on fixture assertions.',
      },
    },
    setup: {
      contextType: 'dm',
      provider: 'kaneo',
      enabledTools: ['search_tools', 'load_tool', 'expand_result'],
      flags: { progressive_disclosure: true, result_compaction: true, semantic_tool_retrieval: true },
    },
    expected: {},
  },
]
