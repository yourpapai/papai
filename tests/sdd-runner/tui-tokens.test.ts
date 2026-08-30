// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import { colorModeFor, costToken, retryToken, severityToken, stageToken } from '../../sdd-runner/src/tui-tokens.js'

/**
 * Semantic color tokens (fancy-ui 2.x): exact-value assertions on the token
 * map and the `colorModeFor(env)` truth table. Color decorates the existing
 * non-color markers — it never carries meaning alone — and a disabled mode
 * omits color props entirely, which is what makes the NO_COLOR structural
 * parity test pass by construction.
 */

describe('colorModeFor (2.1 truth table)', () => {
  it('NO_COLOR set to any non-empty value disables color', () => {
    expect(colorModeFor({ noColor: '1', colorDepth: 24 })).toBe('monochrome')
    expect(colorModeFor({ noColor: 'true', colorDepth: 8 })).toBe('monochrome')
    expect(colorModeFor({ noColor: '0', colorDepth: 4 })).toBe('monochrome')
  })

  it('an empty NO_COLOR does not disable color', () => {
    expect(colorModeFor({ noColor: '', colorDepth: 8 })).toBe('color')
  })

  it('a colorless terminal (depth below 2) disables color', () => {
    expect(colorModeFor({ noColor: undefined, colorDepth: 0 })).toBe('monochrome')
    expect(colorModeFor({ noColor: undefined, colorDepth: 1 })).toBe('monochrome')
  })

  it('a color-capable terminal with no NO_COLOR gets color', () => {
    expect(colorModeFor({ noColor: undefined, colorDepth: 4 })).toBe('color')
    expect(colorModeFor({ noColor: undefined, colorDepth: 8 })).toBe('color')
    expect(colorModeFor({ noColor: undefined, colorDepth: 24 })).toBe('color')
  })

  it('both disabling signals compose to monochrome', () => {
    expect(colorModeFor({ noColor: '1', colorDepth: 1 })).toBe('monochrome')
  })
})

describe('severity tokens (exact values)', () => {
  it('each severity maps to one exact treatment', () => {
    expect(severityToken('color', 'blocker')).toEqual({ color: 'red', bold: true })
    expect(severityToken('color', 'material')).toEqual({ color: 'yellow' })
    expect(severityToken('color', 'nitpick')).toEqual({ dimColor: true })
  })

  it('the three treatments are pairwise distinct', () => {
    const treatments = (['blocker', 'material', 'nitpick'] as const).map((severity) =>
      JSON.stringify(severityToken('color', severity)),
    )
    expect(new Set(treatments).size).toBe(3)
  })

  it('a disabled mode omits color props entirely', () => {
    expect(severityToken('monochrome', 'blocker')).toEqual({})
    expect(severityToken('monochrome', 'material')).toEqual({})
    expect(severityToken('monochrome', 'nitpick')).toEqual({})
  })
})

describe('stage-status tokens (exact values)', () => {
  it('each stage status maps to one exact treatment', () => {
    expect(stageToken('color', 'pending')).toEqual({ dimColor: true })
    expect(stageToken('color', 'active')).toEqual({ color: 'green', bold: true })
    expect(stageToken('color', 'done')).toEqual({ color: 'green' })
    expect(stageToken('color', 'skipped')).toEqual({ color: 'gray' })
  })

  it('the four treatments are pairwise distinct', () => {
    const treatments = (['pending', 'active', 'done', 'skipped'] as const).map((status) =>
      JSON.stringify(stageToken('color', status)),
    )
    expect(new Set(treatments).size).toBe(4)
  })

  it('a disabled mode omits color props entirely', () => {
    expect(stageToken('monochrome', 'pending')).toEqual({})
    expect(stageToken('monochrome', 'active')).toEqual({})
    expect(stageToken('monochrome', 'done')).toEqual({})
    expect(stageToken('monochrome', 'skipped')).toEqual({})
  })
})

describe('cost tokens (exact values)', () => {
  it('each cost state maps to one exact treatment', () => {
    expect(costToken('color', 'known')).toEqual({ color: 'cyan' })
    expect(costToken('color', 'estimated')).toEqual({ color: 'yellow' })
    expect(costToken('color', 'unknown')).toEqual({ dimColor: true })
  })

  it('the three treatments are pairwise distinct', () => {
    const treatments = (['known', 'estimated', 'unknown'] as const).map((state) =>
      JSON.stringify(costToken('color', state)),
    )
    expect(new Set(treatments).size).toBe(3)
  })

  it('a disabled mode omits color props entirely', () => {
    expect(costToken('monochrome', 'known')).toEqual({})
    expect(costToken('monochrome', 'estimated')).toEqual({})
    expect(costToken('monochrome', 'unknown')).toEqual({})
  })
})

describe('retry badge token (exact values)', () => {
  it('the retry badge carries one exact treatment distinct from severity and stage tokens', () => {
    expect(retryToken('color')).toEqual({ color: 'magenta', bold: true })
    const others = [
      severityToken('color', 'blocker'),
      severityToken('color', 'material'),
      severityToken('color', 'nitpick'),
      stageToken('color', 'pending'),
      stageToken('color', 'active'),
      stageToken('color', 'done'),
      stageToken('color', 'skipped'),
      costToken('color', 'known'),
      costToken('color', 'estimated'),
      costToken('color', 'unknown'),
    ]
    expect(others.map((token) => JSON.stringify(token))).not.toContain(JSON.stringify(retryToken('color')))
  })

  it('a disabled mode omits color props entirely', () => {
    expect(retryToken('monochrome')).toEqual({})
  })
})
