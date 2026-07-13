// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ExtractorFn, SimplifiedNode } from './simplify-types.js'
import { generateCSSShorthand, hasFlexLayout, isInAutoLayoutFlow, isRecord, num, round2, str } from './simplify-util.js'

function alignSelfPart(node: Record<string, unknown>): string | undefined {
  const la = str(node['layoutAlign'])
  if (la === 'MAX') return 'align-self:flex-end'
  if (la === 'CENTER') return 'align-self:center'
  if (la === 'STRETCH') return 'align-self:stretch'
  return undefined
}

function relativePositionParts(node: Record<string, unknown>, parent: Record<string, unknown> | undefined): string[] {
  if (parent === undefined || isInAutoLayoutFlow(node, parent)) return []
  const nodeBox = node['absoluteBoundingBox']
  const parentBox = parent['absoluteBoundingBox']
  if (!isRecord(nodeBox) || !isRecord(parentBox)) return []
  const nx = num(nodeBox['x'])
  const ny = num(nodeBox['y'])
  const px = num(parentBox['x'])
  const py = num(parentBox['y'])
  if (nx === undefined || ny === undefined || px === undefined || py === undefined) return []
  return [`left:${round2(nx - px)}px`, `top:${round2(ny - py)}px`]
}

function justifyContentPart(node: Record<string, unknown>): string | undefined {
  const pa = str(node['primaryAxisAlignItems'])
  if (pa === 'MAX') return 'justify-content:flex-end'
  if (pa === 'CENTER') return 'justify-content:center'
  if (pa === 'SPACE_BETWEEN') return 'justify-content:space-between'
  return undefined
}

function alignItemsPart(node: Record<string, unknown>): string | undefined {
  const ca = str(node['counterAxisAlignItems'])
  if (ca === 'MAX') return 'align-items:flex-end'
  if (ca === 'CENTER') return 'align-items:center'
  if (ca === 'BASELINE') return 'align-items:baseline'
  return undefined
}

function paddingPart(node: Record<string, unknown>): string | undefined {
  const top = round2(num(node['paddingTop']) ?? 0)
  const right = round2(num(node['paddingRight']) ?? 0)
  const bottom = round2(num(node['paddingBottom']) ?? 0)
  const left = round2(num(node['paddingLeft']) ?? 0)
  if (top === 0 && right === 0 && bottom === 0 && left === 0) return undefined
  return `padding:${generateCSSShorthand({ top, right, bottom, left })}`
}

function flexParts(node: Record<string, unknown>, mode: 'row' | 'column'): string[] {
  const parts: string[] = ['display:flex', `flex-direction:${mode}`]
  const jc = justifyContentPart(node)
  if (jc !== undefined) parts.push(jc)
  const ai = alignItemsPart(node)
  if (ai !== undefined) parts.push(ai)
  if (node['layoutWrap'] === 'WRAP') parts.push('flex-wrap:wrap')
  const gap = num(node['itemSpacing'])
  if (gap !== undefined && gap > 0) parts.push(`gap:${round2(gap)}px`)
  const pad = paddingPart(node)
  if (pad !== undefined) parts.push(pad)
  return parts
}

function applySizing(
  node: Record<string, unknown>,
  result: SimplifiedNode,
  parent: Record<string, unknown> | undefined,
): void {
  const lsh = str(node['layoutSizingHorizontal'])
  if (lsh !== undefined) result.layoutSizingHorizontal = lsh
  const lsv = str(node['layoutSizingVertical'])
  if (lsv !== undefined) result.layoutSizingVertical = lsv
  if (parent === undefined || !isInAutoLayoutFlow(node, parent)) return
  const box = node['absoluteBoundingBox']
  if (!isRecord(box)) return
  if (lsh === 'FIXED') {
    const w = num(box['width'])
    if (w !== undefined) result.width = round2(w)
  }
  if (lsv === 'FIXED') {
    const h = num(box['height'])
    if (h !== undefined) result.height = round2(h)
  }
}

export const layoutExtractor: ExtractorFn = (node, result, context) => {
  const parent = context.parent
  const parts: string[] = []
  const selfPart = alignSelfPart(node)
  if (selfPart !== undefined) parts.push(selfPart)
  parts.push(...relativePositionParts(node, parent))

  const mode = hasFlexLayout(node) ? (node['layoutMode'] === 'HORIZONTAL' ? 'row' : 'column') : 'none'
  if (mode !== 'none') {
    parts.push(...flexParts(node, mode))
  }
  if (parts.length > 0) result.layout = parts.join(';')
  applySizing(node, result, parent)
}
