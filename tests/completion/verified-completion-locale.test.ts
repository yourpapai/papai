// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  buildVerifiedCompletion,
  type VerifierDeps,
  type VerifierPrompt,
} from '../../src/completion/verified-completion.js'
import type { CompletionTurn } from '../../src/completion/verified-completion.js'
import { mockLogger } from '../utils/test-helpers.js'

const deps = (captured: VerifierPrompt[]): VerifierDeps => ({
  invokeVerifier: (prompt: VerifierPrompt): Promise<{ text: string | undefined; finishReason?: string }> => {
    captured.push(prompt)
    return Promise.resolve({ text: undefined })
  },
  readOnlyToolset: undefined,
})

const turn = (locale?: 'en' | 'ru', hadToolActivity?: boolean): CompletionTurn => ({
  history: [],
  finishReason: 'stop',
  hadToolFailure: false,
  hadToolActivity,
  ...(locale === undefined ? {} : { locale }),
})

describe('verified completion per locale', () => {
  beforeEach(mockLogger)

  test('ru turn: verifier system prompt instructs replying in Russian', async () => {
    const captured: VerifierPrompt[] = []
    await buildVerifiedCompletion(turn('ru'), deps(captured))
    expect(captured[0]?.system).toContain('Отвечай на русском языке')
    expect(captured[0]?.system).not.toContain('same language the user used')
  })

  test('ru turn: neutral fallback is Russian', async () => {
    const result = await buildVerifiedCompletion(turn('ru', true), deps([]))
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toBe(
      'Я выполнил запрошенные действия, но не смог подтвердить результат — пожалуйста, перепроверьте.',
    )
  })

  test('ru turn: no-op fallback says nothing was executed', async () => {
    const result = await buildVerifiedCompletion(turn('ru'), deps([]))
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toBe('Похоже, в этот раз я ничего не выполнил — ход прервался. Пожалуйста, повтори запрос.')
  })

  test('default (en) turn: verifier prompt and fallback stay English', async () => {
    const captured: VerifierPrompt[] = []
    const result = await buildVerifiedCompletion(turn(undefined, true), deps(captured))
    expect(captured[0]?.system).toContain('- Reply in the same language the user used.')
    expect(result.text).toBe('I ran the requested actions but could not confirm the result — please double-check.')
  })

  test('default (en) turn: no-op fallback says nothing was executed', async () => {
    const result = await buildVerifiedCompletion(turn(), deps([]))
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toBe(
      'It looks like nothing was actually executed this turn — it cut off. Please repeat your request.',
    )
  })
})
