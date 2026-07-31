// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/** WCAG 2.2 AA SC 2.5.8 (Target Size, Minimum). */
const MIN_TARGET_PX = 24

const UI_DIR = fileURLToPath(new URL('../../../client/shared/ui/', import.meta.url))
const TOKENS = readFileSync(fileURLToPath(new URL('../../../client/shared/tokens.css', import.meta.url)), 'utf8')

/**
 * Matches a literal pixel height declaration. The lookbehind keeps `line-height`
 * and `max-height` out: neither constrains how small a target can render.
 */
const HEIGHT_PX = /(?<![\w-])(?:min-height|height):\s*(\d+(?:\.\d+)?)px/gu

const CONTROL_TOKEN = /--control-h-([a-z]+):\s*(\d+(?:\.\d+)?)px/gu

/** Primitives whose whole box is the click target — their height must come from the scale. */
const INTERACTIVE = ['Btn.svelte', 'IconButton.svelte', 'Seg.svelte', 'SegmentedControl.svelte']

const readUi = (file: string): string => readFileSync(`${UI_DIR}${file}`, 'utf8')

const literalHeights = (css: string): string[] => [...css.matchAll(HEIGHT_PX)].map((m) => m[0])

describe('control target size', () => {
  test('the height scanner sees real declarations and ignores look-alikes', () => {
    expect(literalHeights('.a { height: 22px; }')).toEqual(['height: 22px'])
    expect(literalHeights('.a {\n  min-height: 120px;\n}')).toEqual(['min-height: 120px'])
    expect(literalHeights('.a { line-height: 22px; max-height: 40px; }')).toEqual([])
    expect(literalHeights('.a { height: var(--control-h-sm); }')).toEqual([])
  })

  test('every --control-h-* token clears the WCAG minimum', () => {
    const found = [...TOKENS.matchAll(CONTROL_TOKEN)].map((m) => ({ name: m[1], px: Number(m[2]) }))
    expect(found.map((t) => t.name)).toEqual(['sm', 'md', 'lg'])
    for (const token of found) {
      expect(token.px).toBeGreaterThanOrEqual(MIN_TARGET_PX)
    }
  })

  test('interactive primitives take their height from the control-height scale', () => {
    for (const file of INTERACTIVE) {
      const css = readUi(file)
      expect({ file, literals: literalHeights(css) }).toEqual({ file, literals: [] })
      expect({ file, usesScale: css.includes('var(--control-h-') }).toEqual({ file, usesScale: true })
    }
  })
})
