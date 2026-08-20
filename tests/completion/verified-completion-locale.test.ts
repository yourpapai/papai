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

const turn = (locale?: 'en' | 'ru'): CompletionTurn => ({
  history: [],
  finishReason: 'stop',
  hadToolFailure: false,
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
    const result = await buildVerifiedCompletion(turn('ru'), deps([]))
    expect(result.verdict).toBe('unconfirmed')
    expect(result.text).toBe(
      'Я выполнил запрошенные действия, но не смог подтвердить результат — пожалуйста, перепроверьте.',
    )
  })

  test('default (en) turn: verifier prompt and fallback stay English', async () => {
    const captured: VerifierPrompt[] = []
    const result = await buildVerifiedCompletion(turn(), deps(captured))
    expect(captured[0]?.system).toContain('- Reply in the same language the user used.')
    expect(result.text).toBe('I ran the requested actions but could not confirm the result — please double-check.')
  })
})
