// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  figmaGetCommentsSchema,
  figmaGetComponentsSchema,
  figmaGetFileNodesSchema,
  figmaGetFileSchema,
  figmaGetFileStylesSchema,
  figmaGetImagesSchema,
  figmaGetStyleSchema,
} from '../../plugins/mcp-figma/input-schema.js'

// papai does not locally validate plugin MCP tool inputs at runtime: the plugin
// bridge (src/plugins/input-schema.ts) wraps these raw JSON-Schema objects with the
// `ai` SDK's `jsonSchema()` helper, which performs no validation of its own (that's
// left to the model/provider). So these tests assert the declared contract of each
// schema — required fields, closed shape — rather than simulating validation
// behavior that never runs in production.
describe('mcp-figma schemas', () => {
  test('get_file requires fileKey and rejects unknown properties', () => {
    expect(figmaGetFileSchema.required).toContain('fileKey')
    expect(figmaGetFileSchema.additionalProperties).toBe(false)
  })

  test('get_file_nodes requires fileKey and ids', () => {
    expect(figmaGetFileNodesSchema.required).toContain('fileKey')
    expect(figmaGetFileNodesSchema.required).toContain('ids')
  })

  test('get_images requires fileKey and ids but not format/scale, and constrains format/scale shapes', () => {
    expect(figmaGetImagesSchema.required).toContain('fileKey')
    expect(figmaGetImagesSchema.required).toContain('ids')
    expect(figmaGetImagesSchema.required).not.toContain('format')
    expect(figmaGetImagesSchema.required).not.toContain('scale')
    expect(figmaGetImagesSchema.properties.format.enum).toEqual(['png', 'svg', 'pdf'])
    expect(figmaGetImagesSchema.properties.scale.type).toBe('number')
  })

  test('get_file_styles requires fileKey', () => {
    expect(figmaGetFileStylesSchema.required).toContain('fileKey')
  })

  test('get_style requires fileKey and styleKey', () => {
    expect(figmaGetStyleSchema.required).toContain('fileKey')
    expect(figmaGetStyleSchema.required).toContain('styleKey')
  })

  test('get_components requires fileKey', () => {
    expect(figmaGetComponentsSchema.required).toContain('fileKey')
  })

  test('get_comments requires fileKey', () => {
    expect(figmaGetCommentsSchema.required).toContain('fileKey')
  })
})
