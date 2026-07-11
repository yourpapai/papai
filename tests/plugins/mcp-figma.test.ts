// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { parseIds, simplifyFigmaResponse } from '../../plugins/mcp-figma/format.js'

describe('mcp-figma simplify', () => {
  test('simplifies a GetFile shape: drops hidden nodes, rounds dimensions, keeps text style, no extra keys', () => {
    const apiResponse = {
      name: 'Doc',
      document: {
        name: 'D',
        children: [
          {
            id: '1:1',
            name: 'Frame',
            type: 'FRAME',
            visible: true,
            absoluteBoundingBox: { width: 100.126, height: 50 },
            layoutMode: 'VERTICAL',
            children: [
              {
                id: '1:2',
                name: 'Label',
                type: 'TEXT',
                characters: 'Hi',
                style: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600, lineHeightPx: 20 },
              },
              {
                id: '1:3',
                name: 'Hidden',
                type: 'RECTANGLE',
                visible: false,
              },
            ],
          },
        ],
      },
    }

    expect(simplifyFigmaResponse(apiResponse)).toEqual({
      name: 'Doc',
      nodes: [
        {
          id: '1:1',
          name: 'Frame',
          type: 'FRAME',
          width: 100.13,
          height: 50,
          layoutMode: 'VERTICAL',
          children: [
            {
              id: '1:2',
              name: 'Label',
              type: 'TEXT',
              text: 'Hi',
              textStyle: { fontFamily: 'Inter', fontSize: 14, fontWeight: 600 },
            },
          ],
        },
      ],
    })
  })

  test('simplifies a GetFileNodes shape and maps VECTOR to IMAGE-SVG', () => {
    const apiResponse = {
      nodes: {
        '1:1': { document: { id: '1:1', name: 'N', type: 'VECTOR' } },
      },
    }

    expect(simplifyFigmaResponse(apiResponse)).toEqual({
      name: '',
      nodes: [{ id: '1:1', name: 'N', type: 'IMAGE-SVG' }],
    })
  })

  test('non-record input yields empty result', () => {
    expect(simplifyFigmaResponse(null)).toEqual({ name: '', nodes: [] })
    expect(simplifyFigmaResponse('x')).toEqual({ name: '', nodes: [] })
    expect(simplifyFigmaResponse(42)).toEqual({ name: '', nodes: [] })
  })

  test('GetFileNodes shape with empty nodes map yields empty result', () => {
    expect(simplifyFigmaResponse({ nodes: {} })).toEqual({ name: '', nodes: [] })
  })

  test('parseIds splits on commas/semicolons, trims, strips leading I, drops empties', () => {
    expect(parseIds('I1:2; 3:4 ,,5:6')).toEqual(['1:2', '3:4', '5:6'])
    expect(parseIds('')).toEqual([])
  })
})
