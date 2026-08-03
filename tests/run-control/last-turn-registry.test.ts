// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, it } from 'bun:test'

import { lastTurnRegistry } from '../../src/run-control/last-turn-registry.js'

describe('LastTurnRegistry', () => {
  beforeEach(() => lastTurnRegistry.clear())

  it('records and retrieves by contextId', () => {
    lastTurnRegistry.record('ctx', {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: undefined,
      finishedAt: 1,
    })
    expect(lastTurnRegistry.get('ctx')?.originatingMessageIds).toEqual(['m1'])
  })

  it('evicts', () => {
    lastTurnRegistry.record('ctx', {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: undefined,
      finishedAt: 1,
    })
    lastTurnRegistry.evict('ctx')
    expect(lastTurnRegistry.get('ctx')).toBeUndefined()
  })

  it('returns undefined for unknown contextId', () => {
    expect(lastTurnRegistry.get('nope')).toBeUndefined()
  })

  it('overwrites a previous last-turn on re-record', () => {
    lastTurnRegistry.record('ctx', {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: undefined,
      finishedAt: 1,
    })
    lastTurnRegistry.record('ctx', {
      originatingMessageIds: ['m2'],
      completedEffects: [],
      replyTarget: undefined,
      finishedAt: 2,
    })
    expect(lastTurnRegistry.get('ctx')?.originatingMessageIds).toEqual(['m2'])
    expect(lastTurnRegistry.get('ctx')?.finishedAt).toBe(2)
  })

  it('clear empties the registry', () => {
    lastTurnRegistry.record('ctx', {
      originatingMessageIds: ['m1'],
      completedEffects: [],
      replyTarget: undefined,
      finishedAt: 1,
    })
    lastTurnRegistry.clear()
    expect(lastTurnRegistry.get('ctx')).toBeUndefined()
  })
})
