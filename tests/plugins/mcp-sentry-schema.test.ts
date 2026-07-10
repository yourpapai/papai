// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  sentryGetIssueSchema,
  sentryGetIssueDetailsSchema,
  sentrySearchIssuesSchema,
  sentryGetIssueTagValuesSchema,
} from '../../plugins/mcp-sentry/input-schema.js'

// `schemaValidates()` in tests/utils/test-helpers.ts takes a *registered tool*
// (`{ inputSchema: ZodType }`) and calls `.safeParse` on its `inputSchema` — it is
// built for the Zod-schema tools under src/tools/, not for raw JSON-Schema objects.
// mcp-sentry's input-schema.ts exports raw JSON-Schema `as const` objects (mirroring
// synthetic-web-search/input-schema.ts), which have no `safeParse`; the plugin bridge
// (src/plugins/input-schema.ts) wraps them with the `ai` SDK's `jsonSchema()` helper,
// which — absent a custom `validate` callback — performs no local validation at all
// (that's left to the model/provider). So neither the raw object nor the wrapped form
// can be exercised through `schemaValidates()` as written.
//
// This local `schemaValidates` reimplements just the JSON-Schema keywords these
// schemas use (type/required/enum/additionalProperties) to preserve the intent of
// the four acceptance/rejection assertions below.
interface JsonSchemaProperty {
  readonly type?: string
  readonly enum?: readonly string[]
}
interface JsonSchemaLike {
  readonly properties?: Readonly<Record<string, JsonSchemaProperty>>
  readonly required?: readonly string[]
  readonly additionalProperties?: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function schemaValidates(schema: JsonSchemaLike, data: unknown): boolean {
  if (!isRecord(data)) return false
  const properties = schema.properties ?? {}

  for (const key of schema.required ?? []) {
    if (!(key in data)) return false
  }

  for (const [key, value] of Object.entries(data)) {
    const propSchema = properties[key]
    if (propSchema === undefined) {
      if (schema.additionalProperties === false) return false
      continue
    }
    if (propSchema.type === 'string' && typeof value !== 'string') return false
    if (propSchema.type === 'integer' && (typeof value !== 'number' || !Number.isInteger(value))) return false
    if (propSchema.enum !== undefined && !(typeof value === 'string' && propSchema.enum.includes(value))) return false
  }

  return true
}

describe('mcp-sentry schemas', () => {
  test('get_issue requires issueId', () => {
    expect(schemaValidates(sentryGetIssueSchema, { issueId: 'ABC-1' })).toBe(true)
    expect(schemaValidates(sentryGetIssueSchema, {})).toBe(false)
  })
  test('search_issues accepts optional filters, rejects bad sort', () => {
    expect(schemaValidates(sentrySearchIssuesSchema, {})).toBe(true)
    expect(schemaValidates(sentrySearchIssuesSchema, { limit: 5, sort: 'freq' })).toBe(true)
    expect(schemaValidates(sentrySearchIssuesSchema, { sort: 'nope' })).toBe(false)
  })
  test('tag_values requires issueId and tagKey', () => {
    expect(schemaValidates(sentryGetIssueTagValuesSchema, { issueId: 'A', tagKey: 'release' })).toBe(true)
    expect(schemaValidates(sentryGetIssueTagValuesSchema, { issueId: 'A' })).toBe(false)
  })
  test('get_issue_details requires issueId, allows optional limits', () => {
    expect(schemaValidates(sentryGetIssueDetailsSchema, { issueId: 'A', eventsLimit: 3 })).toBe(true)
    expect(schemaValidates(sentryGetIssueDetailsSchema, {})).toBe(false)
  })
})
