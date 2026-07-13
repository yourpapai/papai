// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  confluenceAddCommentSchema,
  confluenceGetCommentsSchema,
  confluenceGetPageByTitleSchema,
  confluenceGetPageSchema,
  confluenceResolveShortLinkSchema,
} from '../../plugins/mcp-confluence/input-schema.js'

// papai does not locally validate plugin MCP tool inputs at runtime: the plugin
// bridge (src/plugins/input-schema.ts) wraps these raw JSON-Schema objects with the
// `ai` SDK's `jsonSchema()` helper, which performs no validation of its own (that's
// left to the model/provider). So these tests assert the declared contract of each
// schema — required fields, closed shape — rather than simulating validation
// behavior that never runs in production.
describe('mcp-confluence schemas', () => {
  test('get_page requires pageId and rejects unknown properties', () => {
    expect(confluenceGetPageSchema.required).toContain('pageId')
    expect(confluenceGetPageSchema.additionalProperties).toBe(false)
  })

  test('get_page_by_title requires spaceKey and title', () => {
    expect(confluenceGetPageByTitleSchema.required).toContain('spaceKey')
    expect(confluenceGetPageByTitleSchema.required).toContain('title')
  })

  test('get_comments requires pageId', () => {
    expect(confluenceGetCommentsSchema.required).toContain('pageId')
  })

  test('add_comment requires pageId and text', () => {
    expect(confluenceAddCommentSchema.required).toContain('pageId')
    expect(confluenceAddCommentSchema.required).toContain('text')
  })

  test('resolve_short_link requires shortLink and rejects unknown properties', () => {
    expect(confluenceResolveShortLinkSchema.required).toContain('shortLink')
    expect(confluenceResolveShortLinkSchema.additionalProperties).toBe(false)
  })
})
