// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export interface SimplifiedNode {
  id: string
  name: string
  type: string
  width?: number
  height?: number
  text?: string
  textStyle?: { fontFamily?: string; fontSize?: number; fontWeight?: number }
  layoutMode?: 'HORIZONTAL' | 'VERTICAL'
  children?: SimplifiedNode[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringOr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function numberOr(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function simplifyTextStyle(style: unknown): SimplifiedNode['textStyle'] | undefined {
  if (!isRecord(style)) return undefined
  const ts: NonNullable<SimplifiedNode['textStyle']> = {}
  const fontFamily = stringOr(style['fontFamily'])
  if (fontFamily !== undefined) ts.fontFamily = fontFamily
  const fontSize = numberOr(style['fontSize'])
  if (fontSize !== undefined) ts.fontSize = fontSize
  const fontWeight = numberOr(style['fontWeight'])
  if (fontWeight !== undefined) ts.fontWeight = fontWeight
  return Object.keys(ts).length > 0 ? ts : undefined
}

function processNode(node: unknown): SimplifiedNode | null {
  if (!isRecord(node)) return null
  if (node['visible'] === false) return null

  const type0 = stringOr(node['type']) ?? ''
  const result: SimplifiedNode = {
    id: stringOr(node['id']) ?? '',
    name: stringOr(node['name']) ?? '',
    type: type0 === 'VECTOR' ? 'IMAGE-SVG' : type0,
  }

  const box = node['absoluteBoundingBox']
  if (isRecord(box)) {
    const w = numberOr(box['width'])
    const h = numberOr(box['height'])
    if (w !== undefined) result.width = round2(w)
    if (h !== undefined) result.height = round2(h)
  }

  if (type0 === 'TEXT') {
    const text = stringOr(node['characters'])
    if (text !== undefined) result.text = text
    const textStyle = simplifyTextStyle(node['style'])
    if (textStyle !== undefined) result.textStyle = textStyle
  }

  const layoutMode = node['layoutMode']
  if (layoutMode === 'HORIZONTAL' || layoutMode === 'VERTICAL') result.layoutMode = layoutMode

  const children = node['children']
  if (Array.isArray(children)) {
    const kids = children.map((child) => processNode(child)).filter((n): n is SimplifiedNode => n !== null)
    if (kids.length > 0) result.children = kids
  }

  return result
}

function rootNodesFromGetFileNodes(nodes: Record<string, unknown>): unknown[] {
  const first = Object.values(nodes)[0]
  if (isRecord(first) && isRecord(first['document'])) return [first['document']]
  return []
}

export function simplifyFigmaResponse(apiResponse: unknown): { name: string; nodes: SimplifiedNode[] } {
  let rawNodes: unknown[] = []
  let name = ''

  if (isRecord(apiResponse) && isRecord(apiResponse['nodes'])) {
    rawNodes = rootNodesFromGetFileNodes(apiResponse['nodes'])
    name = stringOr(apiResponse['name']) ?? ''
  } else if (isRecord(apiResponse) && isRecord(apiResponse['document'])) {
    const document = apiResponse['document']
    rawNodes = Array.isArray(document['children']) ? document['children'] : []
    name = stringOr(apiResponse['name']) ?? stringOr(document['name']) ?? ''
  }

  const nodes = rawNodes.map((node) => processNode(node)).filter((n): n is SimplifiedNode => n !== null)
  return { name, nodes }
}

export function parseIds(raw: string): string[] {
  return raw
    .split(/[,;]+/u)
    .map((s) => s.trim().replace(/^I/u, ''))
    .filter((s) => s.length > 0)
}
