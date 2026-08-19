// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { en } from '../../src/i18n/locales/en.js'
import { ru } from '../../src/i18n/locales/ru.js'
import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/test-helpers.js'

// src/i18n/index.ts logs fallbacks through the module-level logger, so it is
// loaded via cache-busting dynamic import AFTER the tracked logger mock is
// installed (same pattern as tests/startup-helpers.test.ts).
type I18nModule = typeof import('../../src/i18n/index.js')

const isI18nModule = (value: unknown): value is I18nModule =>
  typeof value === 'object' &&
  value !== null &&
  typeof Reflect.get(value, 't') === 'function' &&
  typeof Reflect.get(value, 'isSupportedLocale') === 'function'

async function loadI18n(tracked: TrackedLoggerMock): Promise<I18nModule> {
  void mock.module('../../src/logger.js', () => ({
    getLogLevel: tracked.getLogLevel,
    logger: tracked.logger,
  }))
  const loaded: unknown = await import(`../../src/i18n/index.js?t=${crypto.randomUUID()}`)
  if (!isI18nModule(loaded)) throw new Error('i18n module did not export the expected API')
  return loaded
}

describe('i18n module', () => {
  test('SUPPORTED_LOCALES lists en and ru', async () => {
    const i18n = await loadI18n(createTrackedLoggerMock())
    expect(i18n.SUPPORTED_LOCALES).toEqual(['en', 'ru'])
  })

  test('isSupportedLocale accepts exactly the supported locales', async () => {
    const i18n = await loadI18n(createTrackedLoggerMock())
    expect(i18n.isSupportedLocale('en')).toBe(true)
    expect(i18n.isSupportedLocale('ru')).toBe(true)
    expect(i18n.isSupportedLocale('de')).toBe(false)
    expect(i18n.isSupportedLocale('EN')).toBe(false)
    expect(i18n.isSupportedLocale('')).toBe(false)
  })

  test('getDictionary returns the catalog for each supported locale', async () => {
    const i18n = await loadI18n(createTrackedLoggerMock())
    expect(i18n.getDictionary('en')).toBe(en)
    expect(i18n.getDictionary('ru')).toBe(ru)
  })

  test('t returns the en entry for the en locale', async () => {
    const i18n = await loadI18n(createTrackedLoggerMock())
    expect(i18n.t('commands.stop.nothingRunning', 'en')).toBe(en.commands.stop.nothingRunning)
    expect(i18n.t('commands.start.welcome', 'en')).toBe(en.commands.start.welcome)
  })

  test('t defaults to the en locale when none is given', async () => {
    const i18n = await loadI18n(createTrackedLoggerMock())
    expect(i18n.t('commands.stop.nothingRunning')).toBe(en.commands.stop.nothingRunning)
  })

  test('t returns the ru entry for the ru locale', async () => {
    const i18n = await loadI18n(createTrackedLoggerMock())
    expect(i18n.t('commands.stop.nothingRunning', 'ru')).toBe(ru.commands.stop.nothingRunning)
    expect(i18n.t('commands.stop.nothingRunning', 'ru')).not.toBe(en.commands.stop.nothingRunning)
    expect(i18n.t('commands.stop.nothingRunning', 'ru')).toBe('Сейчас ничего не выполняется.')
  })
})
