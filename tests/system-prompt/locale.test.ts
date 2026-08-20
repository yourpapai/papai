// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setConfigValue } from '../../src/config.js'
import { buildProviderlessSystemPrompt, buildSystemPrompt } from '../../src/system-prompt.js'
import { createMockProvider } from '../tools/mock-provider.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const CFG_CTX = 'ctx-prompt-lang'

describe('system prompt per locale', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  describe('ru-configured context', () => {
    beforeEach(() => {
      setConfigValue(CFG_CTX, 'language', 'ru')
    })

    test('uses Russian fragments and the answer-in-Russian instruction', () => {
      const prompt = buildSystemPrompt(createMockProvider(), CFG_CTX)
      expect(prompt).toContain('Отвечай пользователю на русском языке')
      expect(prompt).toContain('Ты — papai')
      expect(prompt).not.toContain('You are papai')
    })

    test('keeps tool names, parameter keys and JSON examples verbatim', () => {
      const prompt = buildSystemPrompt(createMockProvider(), CFG_CTX, new Set(['create_task', 'update_task']), {
        askPermissionAvailable: false,
      })
      expect(prompt).toContain('dueDate: { date: "YYYY-MM-DD", time: "17:00" }')
      // Ungated build carries every fragment's tool references verbatim.
      const full = buildSystemPrompt(createMockProvider(), CFG_CTX)
      expect(full).toContain('web_fetch')
      expect(full).toContain('save_instruction')
    })

    test('providerless variant uses the Russian providerless intro', () => {
      const prompt = buildProviderlessSystemPrompt(CFG_CTX, new Set<string>(), { askPermissionAvailable: false })
      expect(prompt).toContain('Инструменты трекера задач в этом чате недоступны')
      expect(prompt).not.toContain('task tracker tools are unavailable')
    })
  })

  describe('unset language (default en)', () => {
    test('keeps the English prompt and answers in English', () => {
      const prompt = buildSystemPrompt(createMockProvider(), CFG_CTX)
      expect(prompt).toContain('You are papai')
      expect(prompt).toContain('Always write your replies to the user in English')
    })

    test("no longer mirrors the user's language", () => {
      const prompt = buildSystemPrompt(createMockProvider(), CFG_CTX)
      expect(prompt).not.toContain("in the user's language")
    })

    test('keeps tool names and JSON examples verbatim', () => {
      const prompt = buildSystemPrompt(createMockProvider(), CFG_CTX, new Set(['create_task', 'update_task']), {
        askPermissionAvailable: false,
      })
      expect(prompt).toContain('dueDate: { date: "YYYY-MM-DD", time: "17:00" }')
      // Ungated build carries every fragment's tool references verbatim.
      const full = buildSystemPrompt(createMockProvider(), CFG_CTX)
      expect(full).toContain('web_fetch')
      expect(full).toContain('save_instruction')
    })
  })
})
