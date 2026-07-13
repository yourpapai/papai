// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { layoutExtractor } from '../../plugins/mcp-figma/simplify-layout.js'
import { textExtractor } from '../../plugins/mcp-figma/simplify-text.js'
import type { SimplifiedNode, TraversalContext } from '../../plugins/mcp-figma/simplify-types.js'
import { generateCSSShorthand, hasFlexLayout, isInAutoLayoutFlow } from '../../plugins/mcp-figma/simplify-util.js'

function freshContext(parent?: Record<string, unknown>): TraversalContext {
  return { globalVars: { styles: {} }, styleIndex: new Map<string, string>(), counter: { n: 0 }, parent }
}

function runLayout(node: Record<string, unknown>, parent?: Record<string, unknown>): SimplifiedNode {
  const result: SimplifiedNode = { id: 'x', name: 'x', type: 'FRAME' }
  layoutExtractor(node, result, freshContext(parent))
  return result
}

describe('simplify-util', () => {
  test('generateCSSShorthand collapses equal sides', () => {
    expect(generateCSSShorthand({ top: 8, right: 8, bottom: 8, left: 8 })).toBe('8px')
    expect(generateCSSShorthand({ top: 8, right: 4, bottom: 8, left: 4 })).toBe('8px 4px')
    expect(generateCSSShorthand({ top: 1, right: 2, bottom: 3, left: 4 })).toBe('1px 2px 3px 4px')
  })

  test('hasFlexLayout + isInAutoLayoutFlow', () => {
    expect(hasFlexLayout({ layoutMode: 'HORIZONTAL' })).toBe(true)
    expect(hasFlexLayout({ layoutMode: 'NONE' })).toBe(false)
    const parent = { layoutMode: 'VERTICAL' }
    expect(isInAutoLayoutFlow({}, parent)).toBe(true)
    expect(isInAutoLayoutFlow({ layoutPositioning: 'ABSOLUTE' }, parent)).toBe(false)
    expect(isInAutoLayoutFlow({}, undefined)).toBe(false)
  })
})

describe('layoutExtractor', () => {
  test('flex row with justify/align/gap/padding', () => {
    const node = {
      layoutMode: 'HORIZONTAL',
      primaryAxisAlignItems: 'CENTER',
      counterAxisAlignItems: 'MAX',
      itemSpacing: 8,
      paddingTop: 16,
      paddingRight: 16,
      paddingBottom: 16,
      paddingLeft: 16,
    }
    expect(runLayout(node).layout).toBe(
      'display:flex;flex-direction:row;justify-content:center;align-items:flex-end;gap:8px;padding:16px',
    )
  })

  test('non-flex node with only align-self emits align-self', () => {
    expect(runLayout({ layoutAlign: 'CENTER' }).layout).toBe('align-self:center')
  })

  test('non-flex node with nothing emits no layout', () => {
    expect(runLayout({}).layout).toBeUndefined()
  })

  test('non-autolayout child gets left/top relative to parent', () => {
    const parent = { layoutMode: 'NONE', absoluteBoundingBox: { x: 10, y: 20, width: 100, height: 100 } }
    const node = { absoluteBoundingBox: { x: 25, y: 50, width: 10, height: 10 } }
    expect(runLayout(node, parent).layout).toBe('left:15px;top:30px')
  })

  test('FIXED-sized autolayout child keeps width/height', () => {
    const parent = { layoutMode: 'VERTICAL', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } }
    const node = {
      layoutMode: 'HORIZONTAL',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'HUG',
      absoluteBoundingBox: { x: 0, y: 0, width: 42.005, height: 12 },
    }
    const out = runLayout(node, parent)
    expect(out.layoutSizingHorizontal).toBe('FIXED')
    expect(out.width).toBe(42.01)
  })

  test('non-flex leaf child of an autolayout parent still carries sizing', () => {
    const parent = { layoutMode: 'HORIZONTAL', absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 } }
    const node = {
      type: 'RECTANGLE',
      layoutSizingHorizontal: 'FIXED',
      layoutSizingVertical: 'HUG',
      absoluteBoundingBox: { x: 0, y: 0, width: 42.005, height: 12 },
    }
    const out = runLayout(node, parent)
    expect(out.layoutSizingHorizontal).toBe('FIXED')
    expect(out.layoutSizingVertical).toBe('HUG')
    expect(out.width).toBe(42.01)
  })

  test('primaryAxisAlignItems SPACE_BETWEEN emits justify-content:space-between', () => {
    const node = { layoutMode: 'HORIZONTAL', primaryAxisAlignItems: 'SPACE_BETWEEN' }
    expect(runLayout(node).layout).toContain('justify-content:space-between')
  })

  test('layoutWrap WRAP emits flex-wrap:wrap', () => {
    const node = { layoutMode: 'HORIZONTAL', layoutWrap: 'WRAP' }
    expect(runLayout(node).layout).toContain('flex-wrap:wrap')
  })

  test('layoutAlign STRETCH and MAX emit align-self variants', () => {
    expect(runLayout({ layoutAlign: 'STRETCH' }).layout).toBe('align-self:stretch')
    expect(runLayout({ layoutAlign: 'MAX' }).layout).toBe('align-self:flex-end')
  })

  test('fractional gap and padding are rounded to 2 decimals', () => {
    const node = {
      layoutMode: 'HORIZONTAL',
      itemSpacing: 8.005,
      paddingTop: 4.006,
      paddingRight: 4.006,
      paddingBottom: 4.006,
      paddingLeft: 4.006,
    }
    const layout = runLayout(node).layout
    expect(layout).toContain('gap:8.01px')
    expect(layout).toContain('padding:4.01px')
  })
})

describe('textExtractor + globalVars dedup', () => {
  test('extracts text + maps a de-duplicated style reference', () => {
    const ctx = freshContext()
    const a: SimplifiedNode = { id: 'a', name: 'A', type: 'TEXT' }
    textExtractor(
      { type: 'TEXT', characters: 'Hello', style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600 } },
      a,
      ctx,
    )
    const b: SimplifiedNode = { id: 'b', name: 'B', type: 'TEXT' }
    textExtractor(
      { type: 'TEXT', characters: 'World', style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600 } },
      b,
      ctx,
    )
    expect(a.text).toBe('Hello')
    expect(a.textStyle).toBe('s1')
    // identical style → same id (deduped)
    expect(b.textStyle).toBe('s1')
    expect(Object.keys(ctx.globalVars.styles)).toEqual(['s1'])
    expect(ctx.globalVars.styles['s1']).toEqual({ fontFamily: 'Inter', fontSize: 14, fontWeight: 600 })
  })

  test('distinct styles get distinct ids; default values dropped', () => {
    const ctx = freshContext()
    const n: SimplifiedNode = { id: 'n', name: 'N', type: 'TEXT' }
    textExtractor(
      {
        type: 'TEXT',
        characters: 'x',
        style: {
          fontFamily: 'Inter',
          // dropped (default)
          fontStyle: 'Regular',
          // dropped (default)
          textCase: 'ORIGINAL',
          // kept → textAlign
          textAlignHorizontal: 'CENTER',
          // dropped (0)
          letterSpacing: 0,
          // kept, rounded
          lineHeightPx: 20.004,
        },
      },
      n,
      ctx,
    )
    expect(n.textStyle).toBe('s1')
    expect(ctx.globalVars.styles['s1']).toEqual({ fontFamily: 'Inter', textAlign: 'CENTER', lineHeightPx: 20 })
  })

  test('non-TEXT node is untouched', () => {
    const ctx = freshContext()
    const r: SimplifiedNode = { id: 'r', name: 'R', type: 'RECTANGLE' }
    textExtractor({ type: 'RECTANGLE', characters: 'nope' }, r, ctx)
    expect(r.text).toBeUndefined()
    expect(r.textStyle).toBeUndefined()
    expect(Object.keys(ctx.globalVars.styles)).toEqual([])
  })
})
