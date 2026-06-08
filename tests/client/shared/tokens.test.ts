// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const css = readFileSync(fileURLToPath(new URL('../../../client/shared/tokens.css', import.meta.url)), 'utf8')

describe('design tokens', () => {
  test('defines spec-named semantic color tokens', () => {
    for (const t of [
      '--surface-1',
      '--surface-2',
      '--surface-hover',
      '--text',
      '--text-muted',
      '--text-dim',
      '--accent-fg',
      '--state-active',
      '--danger-surface',
    ]) {
      expect(css).toContain(`${t}:`)
    }
  })
  test('defines layout + sizing tokens', () => {
    for (const t of [
      '--content-max',
      '--table-max',
      '--gap-group',
      '--gap-section',
      '--gap-field',
      '--gap-inline',
      '--radius',
      '--radius-pill',
      '--row-h',
    ]) {
      expect(css).toContain(`${t}:`)
    }
  })
  test('keeps legacy aliases so debug/admin SPAs still resolve', () => {
    for (const t of ['--surface:', '--raised:', '--fg2:', '--s4:']) {
      expect(css).toContain(t)
    }
  })
  test('adopts the spec accent value', () => {
    expect(css).toContain('#52e08a')
  })
})
