// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ContextSnapshot } from '../../../src/chat/types.js'

export const standardContextSnapshot: ContextSnapshot = {
  modelName: 'gpt-4o',
  totalTokens: 6_770,
  maxTokens: 128_000,
  approximate: false,
  locale: 'en',
  sections: [
    {
      id: 'system_prompt',
      label: 'System prompt',
      tokens: 820,
      children: [
        { id: 'base_instructions', label: 'Base instructions', tokens: 650 },
        { id: 'custom_instructions', label: 'Custom instructions', tokens: 120 },
        { id: 'provider_addendum', label: 'Provider addendum', tokens: 50 },
      ],
    },
    {
      id: 'memory_context',
      label: 'Memory context',
      tokens: 350,
      children: [
        { id: 'summary', label: 'Summary', tokens: 180 },
        { id: 'known_entities', label: 'Known entities', tokens: 170, detail: '12 facts' },
      ],
    },
    {
      id: 'conversation_history',
      label: 'Conversation history',
      tokens: 2_400,
      detail: '34 messages',
    },
    {
      id: 'tools',
      label: 'Tools',
      tokens: 3_200,
      detail: '4 active · 18 available (progressive disclosure)',
    },
  ],
}
