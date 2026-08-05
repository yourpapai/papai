// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { Glob } from 'bun'

/** WCAG 2.2 AA SC 2.5.8 (Target Size, Minimum). */
const MIN_TARGET_PX = 24

const UI_DIR = fileURLToPath(new URL('../../../client/shared/ui/', import.meta.url))
const TOKENS = readFileSync(fileURLToPath(new URL('../../../client/shared/tokens.css', import.meta.url)), 'utf8')

/**
 * Matches a literal pixel height declaration. The lookbehind keeps `line-height`
 * and `max-height` out: neither constrains how small a target can render.
 */
const HEIGHT_PX = /(?<![\w-])(?:min-height|height):\s*(\d+(?:\.\d+)?)px/gu

/**
 * Matches a literal pixel width declaration. Deliberately not folded into
 * `HEIGHT_PX`/the closed-world ratchet: several exempt non-target files declare
 * literal widths for non-click-target reasons, and widening the shared scanner
 * would make them false offenders. This is a targeted, separate check used only
 * by the square-control width assertion below.
 */
const WIDTH_PX = /(?<![\w-])(?:min-width|width):\s*(\d+(?:\.\d+)?)px/gu

const CONTROL_TOKEN = /--control-h-([a-z]+):\s*(\d+(?:\.\d+)?)px/gu

/** Primitives whose whole box is the click target — their height must come from the scale. */
const INTERACTIVE = [
  'Btn.svelte',
  'CopyButton.svelte',
  'DataTable.svelte',
  'IconButton.svelte',
  'Seg.svelte',
  'SegmentedControl.svelte',
]

/** Controls that are square (or square-in-intent) — width must also come from the scale. */
const SQUARE = ['IconButton.svelte', 'CopyButton.svelte']

/**
 * Files allowed to hardcode a px height because the value is not a click target.
 * Adding an entry is a deliberate act and must carry a reason.
 */
const EXEMPT: Record<string, string> = {
  'Checkbox.svelte': '16px box sits inside a clickable <label>, which is the actual target',
  'EmptyState.svelte': 'min-height on a layout container, not a target',
  'ErrorState.svelte': 'min-height on a layout container, not a target',
  'Meter.svelte': '5px progress bar, non-interactive',
}

const readUi = (file: string): string => readFileSync(`${UI_DIR}${file}`, 'utf8')

const literalHeights = (css: string): string[] => [...css.matchAll(HEIGHT_PX)].map((m) => m[0])

const literalWidths = (css: string): string[] => [...css.matchAll(WIDTH_PX)].map((m) => m[0])

/** Every `.svelte` primitive (excluding stories and known-interactive) that hardcodes a height. */
const findHeightOffenders = async (): Promise<string[]> => {
  const glob = new Glob('*.svelte')
  const offenders: string[] = []
  for await (const file of glob.scan({ cwd: UI_DIR })) {
    if (file.endsWith('.stories.svelte')) continue
    if (INTERACTIVE.includes(file)) continue
    if (literalHeights(readUi(file)).length > 0) offenders.push(file)
  }
  return offenders
}

describe('control target size', () => {
  test('the height scanner sees real declarations and ignores look-alikes', () => {
    expect(literalHeights('.a { height: 22px; }')).toEqual(['height: 22px'])
    expect(literalHeights('.a {\n  min-height: 120px;\n}')).toEqual(['min-height: 120px'])
    expect(literalHeights('.a { line-height: 22px; max-height: 40px; }')).toEqual([])
    expect(literalHeights('.a { height: var(--control-h-sm); }')).toEqual([])
  })

  test('the width scanner sees real declarations and ignores look-alikes', () => {
    expect(literalWidths('.a { width: 22px; }')).toEqual(['width: 22px'])
    expect(literalWidths('.a {\n  min-width: 120px;\n}')).toEqual(['min-width: 120px'])
    // max-width caps a box, border-width is not a target dimension: the lookbehind must
    // keep both out, or the square-control guard below starts reporting false offenders.
    expect(literalWidths('.a { max-width: 40px; border-width: 2px; }')).toEqual([])
    expect(literalWidths('.a { width: var(--control-h-sm); }')).toEqual([])
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

  test('no shared primitive hardcodes a height outside the interactive set or the exemption list', async () => {
    const offenders = await findHeightOffenders()
    expect(offenders.sort()).toEqual(Object.keys(EXEMPT).sort())
  })

  test('square controls take their width from the control-height scale', () => {
    for (const file of SQUARE) {
      const css = readUi(file)
      expect({ file, literalWidths: literalWidths(css) }).toEqual({ file, literalWidths: [] })
      expect({ file, widthUsesScale: /(?:min-width|width):\s*var\(--control-h-/u.test(css) }).toEqual({
        file,
        widthUsesScale: true,
      })
    }
  })
})
