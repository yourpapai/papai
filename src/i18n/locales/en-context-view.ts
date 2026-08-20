// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Dictionary } from '../types.js'

/** English `/context` view texts; split out of `en.ts` to keep catalog files small. */
export const enContextView: Dictionary['contextView'] = {
  sections: {
    system_prompt: 'System prompt',
    base_instructions: 'Base instructions',
    custom_instructions: 'Custom instructions',
    provider_addendum: 'Provider addendum',
    memory_context: 'Memory context',
    summary: 'Summary',
    known_entities: 'Known entities',
    conversation_history: 'Conversation history',
    tools: 'Tools',
  },
  factSingular: '{count} fact',
  factPlural: '{count} facts',
  messageSingular: '{count} message',
  messagePlural: '{count} messages',
  progressiveDisclosure: '{active} active · {available} available (progressive disclosure)',
  headerWord: 'Context',
  tokensUnit: 'tokens',
  tokenSuffix: 'tk',
  approximateMarker: '(approximate)',
  approximateFooter: 'token counts are approximate',
}
