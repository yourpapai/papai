// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { ragSearchSchema } from '../../plugins/mcp-rag/input-schema.js'

// papai does not locally validate plugin MCP tool inputs at runtime: the plugin
// bridge (src/plugins/input-schema.ts) wraps these raw JSON-Schema objects with the
// `ai` SDK's `jsonSchema()` helper, which performs no validation of its own (that's
// left to the model/provider). So this test asserts the declared contract of the
// schema — required fields, closed shape — rather than simulating validation
// behavior that never runs in production.
describe('mcp-rag schemas', () => {
  test('rag_search requires query and rejects unknown properties', () => {
    expect(ragSearchSchema.required).toContain('query')
    expect(ragSearchSchema.additionalProperties).toBe(false)
    expect(ragSearchSchema.properties.query.type).toBe('string')
  })
})
