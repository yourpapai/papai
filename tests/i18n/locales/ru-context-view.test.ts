// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ruContextView } from '../../../src/i18n/locales/ru-context-view.js'
import type { Dictionary } from '../../../src/i18n/types.js'

describe('ruContextView fragment', () => {
  test('satisfies the Dictionary contextView shape', () => {
    const fragment: Dictionary['contextView'] = ruContextView
    expect(fragment).toBe(ruContextView)
  })

  test('pins the Russian chrome and detail templates', () => {
    expect(ruContextView.headerWord).toBe('Контекст')
    expect(ruContextView.tokensUnit).toBe('токенов')
    expect(ruContextView.tokenSuffix).toBe('tk')
    expect(ruContextView.approximateMarker).toBe('(приблизительно)')
    expect(ruContextView.approximateFooter).toBe('количество токенов приблизительное')
    expect(ruContextView.factSingular).toBe('{count} факт')
    expect(ruContextView.factPaucal).toBe('{count} факта')
    expect(ruContextView.factPlural).toBe('{count} фактов')
    expect(ruContextView.messageSingular).toBe('{count} сообщение')
    expect(ruContextView.messagePaucal).toBe('{count} сообщения')
    expect(ruContextView.messagePlural).toBe('{count} сообщений')
    expect(ruContextView.progressiveDisclosure).toBe(
      '{active} активных · {available} доступных (прогрессивное раскрытие)',
    )
  })

  test('pins the Russian section labels', () => {
    expect(ruContextView.sections.system_prompt).toBe('Системный промпт')
    expect(ruContextView.sections.base_instructions).toBe('Базовые инструкции')
    expect(ruContextView.sections.custom_instructions).toBe('Пользовательские инструкции')
    expect(ruContextView.sections.provider_addendum).toBe('Дополнение провайдера')
    expect(ruContextView.sections.memory_context).toBe('Контекст памяти')
    expect(ruContextView.sections.summary).toBe('Сводка')
    expect(ruContextView.sections.known_entities).toBe('Известные сущности')
    expect(ruContextView.sections.conversation_history).toBe('История диалога')
    expect(ruContextView.sections.tools).toBe('Инструменты')
  })
})
