// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { en } from '../../../src/i18n/locales/en.js'
import { ru } from '../../../src/i18n/locales/ru.js'
import type { Dictionary } from '../../../src/i18n/types.js'

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
})
