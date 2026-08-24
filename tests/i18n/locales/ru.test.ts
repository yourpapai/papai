// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { en } from '../../../src/i18n/locales/en.js'
import { ru } from '../../../src/i18n/locales/ru.js'
import type { Dictionary } from '../../../src/i18n/types.js'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const subtreeOf = (node: unknown, key: string): Record<string, unknown> => {
  const value = isRecord(node) ? node[key] : undefined
  return isRecord(value) ? value : {}
}

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '')

describe('ru dictionary', () => {
  test('is typed against the same Dictionary shape', () => {
    const catalog: Dictionary = ru
    expect(catalog).toBe(ru)
  })

  test('provides Russian translations for the framework texts', () => {
    expect(ru.commands.stop.nothingRunning).toBe('Сейчас ничего не выполняется.')
    expect(ru.commands.stop.stoppingNow).toBe('🛑 Останавливаю немедленно…')
    expect(ru.commands.stop.windingDown).toBe('🛑 останавливаюсь после этого шага…')
    expect(ru.auth.dmNotAllowed).toBe('Вы не авторизованы для работы с этим ботом.')
    expect(ru.auth.userBlocked).toBe('Вы не авторизованы для работы с этим ботом.')
    expect(ru.progress.toolStarted).toBe('Инструмент `{toolName}` запущен')
    expect(ru.progress.reasoningHidden).toContain('{count}')
    expect(ru.picker.english).toBe('English')
    expect(ru.picker.russian).toBe('Русский')
  })

  test('keeps every interpolated slot the en catalog declares', () => {
    expect(ru.auth.groupNotAllowed).toContain('{groupId}')
    expect(ru.progress.toolStarted).toContain('{toolName}')
    expect(ru.progress.toolFinished).toContain('{toolName}')
    expect(ru.progress.toolFinished).toContain('{status}')
    expect(ru.progress.durationSuffix).toContain('{durationMs}')
    expect(ru.progress.reasoningHidden).toContain('{count}')
    expect(en.auth.groupNotAllowed).toContain('{groupId}')
  })

  test('system-prompt fragments use the Russian imperative and no untranslated leftovers', () => {
    expect(ru.systemPrompt.workflow).toContain('задай ОДИН короткий вопрос')
    expect(ru.systemPrompt.groupReminders).toContain('задай ОДИН короткий вопрос')
    expect(ru.systemPrompt.groupRemindersWithParticipants).toContain('задай ОДИН короткий вопрос')
    expect(ru.systemPrompt.groupRemindersWithParticipants).toContain('задай ОДИН короткий конкретный вопрос')
    expect(ru.systemPrompt.deferred).toContain('берёт на себя расписание')
    expect(ru.systemPrompt.providerlessDeferred).toContain('берёт на себя расписание')
    expect(ru.systemPrompt.deferred).not.toContain('handled by schedule')
    expect(ru.systemPrompt.providerlessDeferred).not.toContain('handled by schedule')
  })

  test('renders the announcements empty release note in Russian', () => {
    const announcements = subtreeOf(ru, 'announcements')
    const note = textOf(announcements['emptyReleaseNote'])
    expect(note.length).toBeGreaterThan(0)
    expect(note).toMatch(/[\u0400-\u04FF]/u)
    expect(note).not.toBe(textOf(subtreeOf(en, 'announcements')['emptyReleaseNote']))
  })

  test('translates the liveStatus seed texts', () => {
    const liveStatus = subtreeOf(ru, 'liveStatus')
    expect(liveStatus['thinking']).toBe('💭 Думаю…')
    expect(liveStatus['preparingResponse']).toBe('💬 Готовлю ответ…')
    expect(liveStatus['runningTool']).toBe('⚙️ Выполняю {tool}…')
  })

  test('translates liveStatus tool labels as Russian gerunds', () => {
    const tools = subtreeOf(subtreeOf(ru, 'liveStatus'), 'tools')
    expect(tools['search_tasks']).toBe('Ищу задачи')
    expect(tools['web_fetch']).toBe('Загружаю')
    expect(tools['create_task']).toBe('Создаю задачу')
  })

  test('translates the contextView chrome', () => {
    const contextView = subtreeOf(ru, 'contextView')
    expect(contextView['headerWord']).toBe('Контекст')
    expect(contextView['tokensUnit']).toContain('токенов')
    expect(contextView['tokenSuffix']).toBe('tk')
    expect(contextView['approximateMarker']).toBe('(приблизительно)')
    expect(contextView['approximateFooter']).toContain('количество токенов приблизительное')
  })

  test('keeps every interpolated slot the en contextView/liveStatus catalogs declare', () => {
    const enLiveStatus = subtreeOf(en, 'liveStatus')
    const ruLiveStatus = subtreeOf(ru, 'liveStatus')
    expect(textOf(enLiveStatus['runningTool'])).toContain('{tool}')
    expect(textOf(ruLiveStatus['runningTool'])).toContain('{tool}')
    const enContextView = subtreeOf(en, 'contextView')
    const ruContextView = subtreeOf(ru, 'contextView')
    expect(textOf(enContextView['progressiveDisclosure'])).toContain('{active}')
    expect(textOf(enContextView['progressiveDisclosure'])).toContain('{available}')
    expect(textOf(ruContextView['progressiveDisclosure'])).toContain('{active}')
    expect(textOf(ruContextView['progressiveDisclosure'])).toContain('{available}')
    expect(textOf(ruContextView['progressiveDisclosure'])).toContain('прогрессивное раскрытие')
    for (const key of [
      'factSingular',
      'factPaucal',
      'factPlural',
      'messageSingular',
      'messagePaucal',
      'messagePlural',
    ] as const) {
      expect(textOf(enContextView[key])).toContain('{count}')
      expect(textOf(ruContextView[key])).toContain('{count}')
    }
  })
})
