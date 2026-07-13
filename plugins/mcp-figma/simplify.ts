// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { layoutExtractor } from './simplify-layout.js'
import { textExtractor } from './simplify-text.js'
import type { ExtractorFn, GlobalVars, SimplifiedDesign, SimplifiedNode, TraversalContext } from './simplify-types.js'
import { isRecord, num, round2, str } from './simplify-util.js'

const extractors: ExtractorFn[] = [layoutExtractor, textExtractor]

function isVisible(node: Record<string, unknown>): boolean {
  return node['visible'] !== false
}

function processNode(node: unknown, context: TraversalContext): SimplifiedNode | null {
  if (!isRecord(node) || !isVisible(node)) return null
  const type0 = str(node['type']) ?? ''
  const result: SimplifiedNode = {
    id: str(node['id']) ?? '',
    name: str(node['name']) ?? '',
    type: type0 === 'VECTOR' ? 'IMAGE-SVG' : type0,
  }
  const box = node['absoluteBoundingBox']
  if (isRecord(box)) {
    const w = num(box['width'])
    const h = num(box['height'])
    if (w !== undefined) result.width = round2(w)
    if (h !== undefined) result.height = round2(h)
  }
  for (const extractor of extractors) extractor(node, result, context)
  const children = node['children']
  if (Array.isArray(children)) {
    const childContext: TraversalContext = { ...context, parent: node }
    const kids = children
      .map((child) => processNode(child, childContext))
      .filter((n): n is SimplifiedNode => n !== null)
    if (kids.length > 0) result.children = kids
  }
  return result
}

function rootNodes(apiResponse: Record<string, unknown>): unknown[] {
  const nodes = apiResponse['nodes']
  if (isRecord(nodes)) {
    const first = Object.values(nodes)[0]
    if (isRecord(first) && isRecord(first['document'])) return [first['document']]
    return []
  }
  const document = apiResponse['document']
  if (isRecord(document)) {
    const children = document['children']
    return Array.isArray(children) ? children : []
  }
  return []
}

function designName(apiResponse: Record<string, unknown>): string {
  const name = str(apiResponse['name'])
  if (name !== undefined) return name
  const document = apiResponse['document']
  if (isRecord(document)) return str(document['name']) ?? ''
  return ''
}

export function simplifyFigmaResponse(apiResponse: unknown): SimplifiedDesign {
  const globalVars: GlobalVars = { styles: {} }
  if (!isRecord(apiResponse)) return { name: '', nodes: [], globalVars }
  const context: TraversalContext = { globalVars, styleIndex: new Map<string, string>(), counter: { n: 0 } }
  const nodes = rootNodes(apiResponse)
    .map((node) => processNode(node, context))
    .filter((n): n is SimplifiedNode => n !== null)
  return { name: designName(apiResponse), nodes, globalVars }
}
