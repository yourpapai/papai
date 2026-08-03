// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { PseudonymSchema } from '../../src/analytics/controlled-types.js'
import { createPseudonym, encodeComponents } from '../../src/analytics/identity/pseudonym.js'

const FROZEN_KEY = Buffer.from('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'hex')

describe('pseudonym encoding', () => {
  test('actor byte vector', () => {
    const bytes = encodeComponents('actor:v1', ['platform-1', 'user-42'])
    expect(Buffer.from(bytes).toString('hex')).toBe(
      '6163746f723a7631000000000a706c6174666f726d2d3100000007757365722d3432',
    )
  })

  test('actor pseudonym matches frozen vector', () => {
    const result = createPseudonym({
      key: FROZEN_KEY,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['platform-1', 'user-42'],
    })
    expect(result).toBe(PseudonymSchema.parse('v1.-Pp9s7b-y0A8Vg5NHhv-9yRgT_VLzcc7'))
  })

  test('empty and unicode vector bytes', () => {
    const bytes = encodeComponents('test:v1', ['', 'é', '猫'])
    expect(Buffer.from(bytes).toString('hex')).toBe('746573743a7631000000000000000002c3a900000003e78cab')
  })

  test('empty and unicode vector full digest and truncated base64url', () => {
    const result = createPseudonym({
      key: FROZEN_KEY,
      keyVersion: 'v1',
      domain: 'test:v1',
      components: ['', 'é', '猫'],
    })
    expect(result).toBe(PseudonymSchema.parse('v1.C217GI46LTt-ASBcSt_EubFA7DpW4pw2'))
  })

  test('length-prefix collision boundary: ab,c differs from a,bc', () => {
    const left = createPseudonym({ key: FROZEN_KEY, keyVersion: 'v1', domain: 'test:v1', components: ['ab', 'c'] })
    const right = createPseudonym({ key: FROZEN_KEY, keyVersion: 'v1', domain: 'test:v1', components: ['a', 'bc'] })
    expect(left).not.toBe(right)
  })

  test('different purpose domains produce different pseudonyms', () => {
    const a = createPseudonym({ key: FROZEN_KEY, keyVersion: 'v1', domain: 'actor:v1', components: ['x', 'y'] })
    const b = createPseudonym({ key: FROZEN_KEY, keyVersion: 'v1', domain: 'context:v1', components: ['x', 'y'] })
    expect(a).not.toBe(b)
  })

  test('same input under two key versions differs', () => {
    const keyA = FROZEN_KEY
    const keyB = Buffer.from('1f1e1d1c1b1a191817161514131211100f0e0d0c0b0a09080706050403020100', 'hex')
    const a = createPseudonym({
      key: keyA,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['platform-1', 'user-42'],
    })
    const b = createPseudonym({
      key: keyB,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['platform-1', 'user-42'],
    })
    expect(a).not.toBe(b)
  })

  test('same chat user on two platform instances differs', () => {
    const a = createPseudonym({
      key: FROZEN_KEY,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['platform-a', 'user-42'],
    })
    const b = createPseudonym({
      key: FROZEN_KEY,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['platform-b', 'user-42'],
    })
    expect(a).not.toBe(b)
  })

  test('same actor on one platform instance is stable across contexts', () => {
    const a = createPseudonym({
      key: FROZEN_KEY,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['platform-1', 'user-42'],
    })
    const b = createPseudonym({
      key: FROZEN_KEY,
      keyVersion: 'v1',
      domain: 'actor:v1',
      components: ['platform-1', 'user-42'],
    })
    expect(a).toBe(b)
  })
})

describe('purpose domain fixtures', () => {
  const cases = [
    { domain: 'deployment:v1', components: ['install-uuid'] },
    { domain: 'platform-instance:v1', components: ['platform-1'] },
    { domain: 'actor:v1', components: ['platform-1', 'user-42'] },
    { domain: 'context:v1', components: ['platform-1', 'group-99'] },
    { domain: 'thread:v1', components: ['storage-context-123'] },
    { domain: 'task-instance:v1', components: ['task-1'] },
    { domain: 'turn:v1', components: ['turn-uuid'] },
    { domain: 'llm-attempt:v1', components: ['turn-uuid', 'main', '1'] },
    { domain: 'session:v1', components: ['actor-key', 'conversation-key', '1700000000000', 'first-event-id'] },
    { domain: 'tool:v1', components: ['core', 'task_create'] },
    { domain: 'model:v1', components: ['openai', 'gpt-4o-mini'] },
    { domain: 'coding-project:v1', components: ['platform-1', 'project-7'] },
    { domain: 'coding-session:v1', components: ['platform-1', 'session-9'] },
    { domain: 'governance-actor:v1', components: ['platform-1', 'user-42'] },
  ] as const

  for (const { domain, components } of cases) {
    test(`produces a valid pseudonym for ${domain}`, () => {
      const result = createPseudonym({ key: FROZEN_KEY, keyVersion: 'v1', domain, components })
      expect(result).toMatch(/^v1\.[-_A-Za-z0-9]+$/u)
    })
  }
})
