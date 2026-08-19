// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { en } from '../../src/i18n/locales/en.js'
import { ru } from '../../src/i18n/locales/ru.js'
import type { Dictionary } from '../../src/i18n/types.js'
import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/test-helpers.js'

// src/i18n/index.ts logs fallbacks through the module-level logger, so it is
// loaded via cache-busting dynamic import AFTER the tracked logger mock is
// installed (same pattern as tests/startup-helpers.test.ts).
type I18nModule = typeof import('../../src/i18n/index.js')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

const isI18nModule = (value: unknown): value is I18nModule =>
  isRecord(value) &&
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

function collectLeaves(node: unknown): unknown[] {
  if (!isRecord(node)) return []
  const leaves: unknown[] = []
  for (const value of Object.values(node)) {
    if (typeof value === 'string') leaves.push(value)
    else leaves.push(...collectLeaves(value))
  }
  return leaves
}

const isNonEmptyString = (value: unknown): boolean => typeof value === 'string' && value.length > 0

describe('i18n dictionary', () => {
  test('en catalog satisfies the Dictionary type and every leaf is a non-empty string', () => {
    const catalog: Dictionary = en
    const leaves = collectLeaves(catalog)
    expect(leaves.length).toBeGreaterThan(0)
    expect(leaves.every(isNonEmptyString)).toBe(true)
  })

  test('t falls back to en with a logged warn when the ru key is missing at runtime', async () => {
    const tracked = createTrackedLoggerMock()
    const i18n = await loadI18n(tracked)
    const ruStop = ru.commands.stop
    const original = ruStop.nothingRunning
    Reflect.deleteProperty(ruStop, 'nothingRunning')
    try {
      expect(i18n.t('commands.stop.nothingRunning', 'ru')).toBe('Nothing is running right now.')
    } finally {
      ruStop.nothingRunning = original
    }
    const warns = tracked.getCallsByLevel('warn')
    expect(warns).toHaveLength(1)
    expect(warns[0]?.args[0]).toEqual({ key: 'commands.stop.nothingRunning', locale: 'ru' })
    expect(String(warns[0]?.args[1])).toContain('falling back to en')
  })

  test('t never returns the raw key when it is missing from every catalog', async () => {
    const i18n = await loadI18n(createTrackedLoggerMock())
    const enStop = en.commands.stop
    const ruStop = ru.commands.stop
    const originalEn = enStop.nothingRunning
    const originalRu = ruStop.nothingRunning
    Reflect.deleteProperty(enStop, 'nothingRunning')
    Reflect.deleteProperty(ruStop, 'nothingRunning')
    try {
      expect(() => i18n.t('commands.stop.nothingRunning', 'ru')).toThrow('i18n key not found')
    } finally {
      enStop.nothingRunning = originalEn
      ruStop.nothingRunning = originalRu
    }
  })

  test('t interpolates named slots', async () => {
    const i18n = await loadI18n(createTrackedLoggerMock())
    const groupText = i18n.t('auth.groupNotAllowed', 'en', { groupId: '-100200300' })
    expect(groupText).toContain('(-100200300)')
    expect(groupText).not.toContain('{groupId}')
    const finished = i18n.t('progress.toolFinished', 'ru', { toolName: 'create_task', status: 'успешно' })
    expect(finished).toContain('`create_task`')
    expect(finished).toContain('успешно')
    expect(i18n.t('progress.reasoningHidden', 'en', { count: 42 })).toContain('(42 characters)')
  })

  test('t keeps unreferenced slots literal instead of dropping them', async () => {
    const i18n = await loadI18n(createTrackedLoggerMock())
    expect(i18n.t('progress.toolFinished', 'en', { toolName: 'create_task' })).toBe('Tool `create_task` {status}')
  })
})
