// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { RunRegistry } from '../../src/run-control/registry.js'
import { createMockReply } from '../utils/test-helpers.js'

describe('RunRegistry', () => {
  let registry: RunRegistry

  beforeEach(() => {
    registry = new RunRegistry()
  })

  test('begin creates a run retrievable by contextId', () => {
    const { reply } = createMockReply()
    const run = registry.begin('ctx-1', { turnId: 't1', reply })
    expect(run.contextId).toBe('ctx-1')
    expect(run.turnId).toBe('t1')
    expect(run.stopRequested).toBe(false)
    expect(run.steerQueue).toEqual([])
    expect(run.completedEffects).toEqual([])
    expect(registry.get('ctx-1')).toBe(run)
  })

  test('get returns undefined for unknown context', () => {
    expect(registry.get('nope')).toBeUndefined()
  })

  test('end removes the run and returns leftover steer messages', () => {
    const { reply } = createMockReply()
    const run = registry.begin('ctx-1', { turnId: 't1', reply })
    run.steerQueue.push({ text: 'only project X' })
    const leftover = registry.end('ctx-1')
    expect(leftover).toEqual([{ text: 'only project X' }])
    expect(registry.get('ctx-1')).toBeUndefined()
  })

  test('end on unknown context returns empty array', () => {
    expect(registry.end('nope')).toEqual([])
  })

  test('one run per context — second begin replaces the first', () => {
    const { reply } = createMockReply()
    registry.begin('ctx-1', { turnId: 't1', reply })
    const second = registry.begin('ctx-1', { turnId: 't2', reply })
    expect(registry.get('ctx-1')).toBe(second)
  })
})
