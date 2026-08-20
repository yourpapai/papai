// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Dictionary } from '../types.js'

/** Russian `/context` view texts; split out of `ru.ts` to keep catalog files small. */
export const ruContextView: Dictionary['contextView'] = {
  sections: {
    system_prompt: 'Системный промпт',
    base_instructions: 'Базовые инструкции',
    custom_instructions: 'Пользовательские инструкции',
    provider_addendum: 'Дополнение провайдера',
    memory_context: 'Контекст памяти',
    summary: 'Сводка',
    known_entities: 'Известные сущности',
    conversation_history: 'История диалога',
    tools: 'Инструменты',
  },
  factSingular: '{count} факт',
  factPaucal: '{count} факта',
  factPlural: '{count} фактов',
  messageSingular: '{count} сообщение',
  messagePaucal: '{count} сообщения',
  messagePlural: '{count} сообщений',
  progressiveDisclosure: '{active} активных · {available} доступных (прогрессивное раскрытие)',
  headerWord: 'Контекст',
  tokensUnit: 'токенов',
  tokenSuffix: 'tk',
  approximateMarker: '(приблизительно)',
  approximateFooter: 'количество токенов приблизительное',
}
