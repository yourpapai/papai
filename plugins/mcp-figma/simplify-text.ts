// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ExtractorFn, TraversalContext } from './simplify-types.js'
import { isRecord, num, round2, str } from './simplify-util.js'

function buildTextStyle(rawStyle: Record<string, unknown>): Record<string, unknown> {
  const style: Record<string, unknown> = {}
  const ff = str(rawStyle['fontFamily'])
  if (ff !== undefined) style['fontFamily'] = ff
  const fw = num(rawStyle['fontWeight'])
  if (fw !== undefined) style['fontWeight'] = fw
  const fsz = num(rawStyle['fontSize'])
  if (fsz !== undefined) style['fontSize'] = fsz
  const fst = str(rawStyle['fontStyle'])
  if (fst !== undefined && fst !== 'Regular') style['fontStyle'] = fst
  const lh = num(rawStyle['lineHeightPx'])
  if (lh !== undefined) style['lineHeightPx'] = round2(lh)
  const ls = num(rawStyle['letterSpacing'])
  if (ls !== undefined && ls !== 0) style['letterSpacing'] = round2(ls)
  const tc = str(rawStyle['textCase'])
  if (tc !== undefined && tc !== 'ORIGINAL') style['textCase'] = tc
  const ta = str(rawStyle['textAlignHorizontal'])
  if (ta !== undefined && ta !== 'LEFT') style['textAlign'] = ta
  const td = str(rawStyle['textDecoration'])
  if (td !== undefined && td !== 'NONE') style['textDecoration'] = td
  const ml = num(rawStyle['maxLines'])
  if (ml !== undefined) {
    style['maxLines'] = ml
    const tt = str(rawStyle['textTruncation'])
    if (tt !== undefined && tt !== 'DISABLED') style['textTruncation'] = tt
  }
  const ps = num(rawStyle['paragraphSpacing'])
  if (ps !== undefined && ps !== 0) style['paragraphSpacing'] = ps
  return style
}

function dedupStyle(context: TraversalContext, style: Record<string, unknown>): string {
  const key = JSON.stringify(style)
  const existing = context.styleIndex.get(key)
  if (existing !== undefined) return existing
  context.counter.n += 1
  const id = `s${context.counter.n}`
  context.styleIndex.set(key, id)
  context.globalVars.styles[id] = style
  return id
}

export const textExtractor: ExtractorFn = (node, result, context) => {
  if (node['type'] !== 'TEXT') return
  const characters = str(node['characters'])
  if (characters !== undefined) result.text = characters
  const rawStyle = node['style']
  if (!isRecord(rawStyle)) return
  const style = buildTextStyle(rawStyle)
  if (Object.keys(style).length === 0) return
  result.textStyle = dedupStyle(context, style)
}
