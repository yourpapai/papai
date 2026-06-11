// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ModelMessage } from 'ai'

import { isValidToolSequence, normalizeToolPairs, resolveTrimmedIndices } from '../src/memory-tool-pairing.js'

const userMsg = (t: string): ModelMessage => ({ role: 'user', content: t })
const asstText = (t: string): ModelMessage => ({ role: 'assistant', content: t })
const asstCall = (id: string): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId: id, toolName: 'get_task', input: {} }],
})
const toolResult = (id: string): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId: id, toolName: 'get_task', output: { type: 'json', value: {} } }],
})

describe('isValidToolSequence', () => {
  test('plain messages are valid', () => {
    expect(isValidToolSequence([userMsg('a'), asstText('b')])).toBe(true)
  })

  test('matched call + result is valid', () => {
    expect(isValidToolSequence([userMsg('a'), asstCall('x'), toolResult('x'), asstText('done')])).toBe(true)
  })

  test('leading tool message is invalid', () => {
    expect(isValidToolSequence([toolResult('x'), asstText('done')])).toBe(false)
  })

  test('tool-call without result is invalid', () => {
    expect(isValidToolSequence([userMsg('a'), asstCall('x')])).toBe(false)
  })

  test('result without call is invalid', () => {
    expect(isValidToolSequence([userMsg('a'), asstText('b'), toolResult('x')])).toBe(false)
  })
})

describe('normalizeToolPairs', () => {
  test('keeps a no-tool selection unchanged', () => {
    const history = [userMsg('0'), asstText('1'), userMsg('2')]
    expect(normalizeToolPairs(history, [0, 2], 10)).toEqual([0, 2])
  })

  test('adds the tool-result when only its assistant call is selected', () => {
    const history = [userMsg('0'), asstCall('x'), toolResult('x'), asstText('3')]
    expect(normalizeToolPairs(history, [1, 3], 10)).toEqual([1, 2, 3])
  })

  test('adds the assistant call when only its tool-result is selected (no leading orphan)', () => {
    const history = [userMsg('0'), asstCall('x'), toolResult('x'), asstText('3')]
    const result = normalizeToolPairs(history, [2, 3], 10)
    expect(result).toEqual([1, 2, 3])
    expect(isValidToolSequence(result.map((i) => history[i]!))).toBe(true)
  })

  test('drops an orphan tool-result whose call is absent from history', () => {
    const history = [toolResult('ghost'), userMsg('1'), asstText('2')]
    expect(normalizeToolPairs(history, [0, 1, 2], 10)).toEqual([1, 2])
  })

  test('drops a truncated exchange missing its result', () => {
    const history = [userMsg('0'), asstCall('x'), userMsg('2')]
    expect(normalizeToolPairs(history, [0, 1, 2], 10)).toEqual([0, 2])
  })

  test('respects trimMax by dropping whole exchanges oldest-first', () => {
    const history = [asstCall('a'), toolResult('a'), asstCall('b'), toolResult('b'), userMsg('u')]
    const result = normalizeToolPairs(history, [0, 1, 2, 3, 4], 3)
    expect(result).toEqual([2, 3, 4])
    expect(isValidToolSequence(result.map((i) => history[i]!))).toBe(true)
  })

  test('keeps an indivisible exchange even if it exceeds trimMax', () => {
    const history = [asstCall('a'), toolResult('a')]
    expect(normalizeToolPairs(history, [0, 1], 1)).toEqual([0, 1])
  })
})

describe('resolveTrimmedIndices', () => {
  test('clamps to trimMax then preserves pairs', () => {
    const history = [asstCall('a'), toolResult('a'), asstCall('b'), toolResult('b'), userMsg('u')]
    const result = resolveTrimmedIndices(history, [0, 1, 2, 3, 4], 1, 3)
    expect(isValidToolSequence(result.map((i) => history[i]!))).toBe(true)
    expect(result.length).toBeLessThanOrEqual(3)
  })

  test('never splits a pair when the model selects only the call', () => {
    const history = [userMsg('0'), asstCall('x'), toolResult('x'), userMsg('3'), asstText('4')]
    const result = resolveTrimmedIndices(history, [1, 3, 4], 1, 10)
    expect(isValidToolSequence(result.map((i) => history[i]!))).toBe(true)
  })

  test('plain history pads up to trimMin', () => {
    const history = Array.from({ length: 10 }, (_, i) => userMsg(`m${i}`))
    const result = resolveTrimmedIndices(history, [0, 1], 5, 10)
    expect(result.length).toBeGreaterThanOrEqual(5)
  })
})
