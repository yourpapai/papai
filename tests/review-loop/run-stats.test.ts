// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { RunStats } from '../../review-loop/src/run-stats.js'

describe('RunStats', () => {
  test('accumulates usage per label and in totals', () => {
    const stats = new RunStats({ startedAt: 0, now: (): number => 0 })
    stats.addUsage('select', { input: 100, output: 10, reasoning: 5 })
    stats.addUsage('improve', { input: 200, output: 20, reasoning: 0 })
    stats.addUsage('improve', { input: 50, output: 5, reasoning: 1 })
    const snap = stats.snapshot()
    expect(snap.totals.input).toBe(350)
    expect(snap.totals.output).toBe(35)
    expect(snap.totals.reasoning).toBe(6)
    expect(snap.perLabel['improve']).toMatchObject({ input: 250, output: 25 })
  })

  test('clamps NaN and negative values to zero', () => {
    const stats = new RunStats({ startedAt: 0, now: (): number => 0 })
    stats.addUsage('a', { input: Number.NaN, output: -5, reasoning: 3 })
    stats.addToolCalls('a', -2)
    stats.addDiff('a', { added: Number.NaN, removed: -1 })
    const snap = stats.snapshot()
    expect(snap.totals).toMatchObject({ input: 0, output: 0, reasoning: 3, toolCalls: 0, added: 0, removed: 0 })
  })

  test('accumulates tool calls and diff per label', () => {
    const stats = new RunStats({ startedAt: 0, now: (): number => 0 })
    stats.addToolCalls('fixer-w1', 3)
    stats.addToolCalls('fixer-w1', 2)
    stats.addDiff('worker-1', { added: 10, removed: 4 })
    const snap = stats.snapshot()
    expect(snap.totals.toolCalls).toBe(5)
    expect(snap.totals.added).toBe(10)
    expect(snap.perLabel['fixer-w1']?.toolCalls).toBe(5)
    expect(snap.perLabel['worker-1']).toMatchObject({ added: 10, removed: 4 })
  })

  test('estimates cost from pricing table and per-delta model', () => {
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } }, startedAt: 0, now: (): number => 0 })
    stats.addUsage('a', { input: 100_000, output: 10_000, reasoning: 0, model: 'm-x' })
    expect(stats.snapshot().totals.estimatedCostUsd).toBeCloseTo(0.45, 10)
  })

  test('omits cost when no pricing entry matches', () => {
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } }, startedAt: 0, now: (): number => 0 })
    stats.addUsage('a', { input: 100, output: 10, reasoning: 0, model: 'other' })
    expect(stats.snapshot().totals.estimatedCostUsd).toBeUndefined()
  })

  test('omits cost when no pricing configured', () => {
    const stats = new RunStats({ startedAt: 0, now: (): number => 0 })
    stats.addUsage('a', { input: 100, output: 10, reasoning: 0, model: 'm-x' })
    expect(stats.snapshot().totals.estimatedCostUsd).toBeUndefined()
  })

  test('constructor model is the fallback when delta has none', () => {
    const stats = new RunStats({
      pricing: { 'm-*': { input: 3, output: 15 } },
      model: 'm-x',
      startedAt: 0,
      now: (): number => 0,
    })
    stats.addUsage('a', { input: 1_000_000, output: 0, reasoning: 0 })
    expect(stats.snapshot().totals.estimatedCostUsd).toBeCloseTo(3, 10)
  })

  test('snapshot returns fresh objects each call', () => {
    const stats = new RunStats({ startedAt: 0, now: (): number => 0 })
    stats.addUsage('a', { input: 1, output: 1, reasoning: 0 })
    const first = stats.snapshot()
    first.totals.input = 999
    first.perLabel['a']!.input = 999
    expect(stats.snapshot().totals.input).toBe(1)
    expect(stats.snapshot().perLabel['a']?.input).toBe(1)
  })

  test('elapsedMs comes from now - startedAt', () => {
    const stats = new RunStats({ startedAt: 1000, now: (): number => 61_000 })
    expect(stats.snapshot().totals.elapsedMs).toBe(60_000)
  })

  test('persist + rehydrate round-trips totals and perLabel', () => {
    const stats = new RunStats({ pricing: { 'm-*': { input: 3, output: 15 } }, startedAt: 0, now: (): number => 0 })
    stats.addUsage('a', { input: 100_000, output: 10_000, reasoning: 0, model: 'm-x' })
    stats.addToolCalls('a', 4)
    stats.addDiff('iter-1', { added: 7, removed: 2 })
    const restored = RunStats.rehydrate(stats.persist(), { pricing: { 'm-*': { input: 3, output: 15 } } })
    const snap = restored.snapshot()
    expect(snap.totals).toMatchObject({ input: 100_000, output: 10_000, toolCalls: 4, added: 7, removed: 2 })
    expect(snap.totals.estimatedCostUsd).toBeCloseTo(0.45, 10)
    expect(snap.perLabel['iter-1']).toMatchObject({ added: 7, removed: 2 })
  })

  test('rehydrate with undefined starts empty', () => {
    const stats = RunStats.rehydrate(undefined, {})
    expect(stats.snapshot().totals.input).toBe(0)
  })
})
