// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { en } from '../../src/i18n/locales/en.js'
import { ru } from '../../src/i18n/locales/ru.js'
import { createTrackedLoggerMock, loadI18nModule } from '../utils/test-helpers.js'

// Type-only reference to the implementation module; the runtime import happens
// inside loadI18nModule after the tracked logger mock is installed.
type I18nModule = typeof import('../../src/i18n/index.js')

describe('i18n module', () => {
  test('SUPPORTED_LOCALES lists en and ru', async () => {
    const i18n: I18nModule = await loadI18nModule(createTrackedLoggerMock())
    expect(i18n.SUPPORTED_LOCALES).toEqual(['en', 'ru'])
  })

  test('isSupportedLocale accepts exactly the supported locales', async () => {
    const i18n = await loadI18nModule(createTrackedLoggerMock())
    expect(i18n.isSupportedLocale('en')).toBe(true)
    expect(i18n.isSupportedLocale('ru')).toBe(true)
    expect(i18n.isSupportedLocale('de')).toBe(false)
    expect(i18n.isSupportedLocale('EN')).toBe(false)
    expect(i18n.isSupportedLocale('')).toBe(false)
  })

  test('getDictionary returns the catalog for each supported locale', async () => {
    const i18n = await loadI18nModule(createTrackedLoggerMock())
    expect(i18n.getDictionary('en')).toBe(en)
    expect(i18n.getDictionary('ru')).toBe(ru)
  })

  test('t returns the en entry for the en locale', async () => {
    const i18n = await loadI18nModule(createTrackedLoggerMock())
    expect(i18n.t('commands.stop.nothingRunning', 'en')).toBe(en.commands.stop.nothingRunning)
    expect(i18n.t('commands.start.welcome', 'en')).toBe(en.commands.start.welcome)
  })

  test('t defaults to the en locale when none is given', async () => {
    const i18n = await loadI18nModule(createTrackedLoggerMock())
    expect(i18n.t('commands.stop.nothingRunning')).toBe(en.commands.stop.nothingRunning)
  })

  test('t returns the ru entry for the ru locale', async () => {
    const i18n = await loadI18nModule(createTrackedLoggerMock())
    expect(i18n.t('commands.stop.nothingRunning', 'ru')).toBe(ru.commands.stop.nothingRunning)
    expect(i18n.t('commands.stop.nothingRunning', 'ru')).not.toBe(en.commands.stop.nothingRunning)
    expect(i18n.t('commands.stop.nothingRunning', 'ru')).toBe('Сейчас ничего не выполняется.')
  })

  test('t falls back to the en liveStatus text with a warn when the ru key is missing', async () => {
    const tracked = createTrackedLoggerMock()
    const i18n = await loadI18nModule(tracked)
    const ruLiveStatus = ru.liveStatus
    const original = ruLiveStatus.thinking
    Reflect.deleteProperty(ruLiveStatus, 'thinking')
    try {
      const rendered = i18n.t('liveStatus.thinking', 'ru')
      expect(rendered).toBe(en.liveStatus.thinking)
      expect(rendered).toBe('💭 Thinking…')
    } finally {
      ruLiveStatus.thinking = original
    }
    const warns = tracked.getCallsByLevel('warn')
    expect(warns).toHaveLength(1)
    expect(warns[0]?.args[0]).toEqual({ key: 'liveStatus.thinking', locale: 'ru' })
    expect(String(warns[0]?.args[1])).toContain('falling back to en')
  })
})
