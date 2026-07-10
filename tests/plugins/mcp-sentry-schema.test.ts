// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  sentryGetIssueSchema,
  sentryGetIssueCommentsSchema,
  sentryGetIssueDetailsSchema,
  sentryGetIssueEventsSchema,
  sentryGetIssueTagValuesSchema,
  sentryGetProjectsSchema,
  sentrySearchIssuesSchema,
} from '../../plugins/mcp-sentry/input-schema.js'

// papai does not locally validate plugin MCP tool inputs at runtime: the plugin
// bridge (src/plugins/input-schema.ts) wraps these raw JSON-Schema objects with the
// `ai` SDK's `jsonSchema()` helper, which performs no validation of its own (that's
// left to the model/provider). So these tests assert the declared contract of each
// schema — required fields, closed shape, and shared field constraints — rather than
// simulating validation behavior that never runs in production.
describe('mcp-sentry schemas', () => {
  test('get_projects has a bounded optional limit and no required fields', () => {
    expect(sentryGetProjectsSchema.properties.limit).toEqual({
      type: 'integer',
      minimum: 1,
      maximum: 100,
      description: 'Max results (1-100)',
    })
    expect(sentryGetProjectsSchema.additionalProperties).toBe(false)
    expect(Object.hasOwn(sentryGetProjectsSchema, 'required')).toBe(false)
  })

  test('search_issues is fully optional and constrains sort to known values', () => {
    expect(Object.hasOwn(sentrySearchIssuesSchema, 'required')).toBe(false)
    expect(sentrySearchIssuesSchema.properties.sort.enum).toEqual(['date', 'freq', 'new', 'priority', 'user'])
    expect(sentrySearchIssuesSchema.properties.limit).toEqual(sentryGetProjectsSchema.properties.limit)
  })

  test('get_issue requires issueId and rejects unknown properties', () => {
    expect(sentryGetIssueSchema.required).toContain('issueId')
    expect(sentryGetIssueSchema.additionalProperties).toBe(false)
  })

  test('get_issue_events requires issueId and shares the limit shape', () => {
    expect(sentryGetIssueEventsSchema.required).toEqual(['issueId'])
    expect(sentryGetIssueEventsSchema.properties.limit).toEqual(sentryGetProjectsSchema.properties.limit)
  })

  test('get_issue_tag_values requires both issueId and tagKey', () => {
    expect(sentryGetIssueTagValuesSchema.required).toContain('issueId')
    expect(sentryGetIssueTagValuesSchema.required).toContain('tagKey')
  })

  test('get_issue_comments requires issueId', () => {
    expect(sentryGetIssueCommentsSchema.required).toEqual(['issueId'])
  })

  test('get_issue_details requires issueId and exposes five optional per-section limits', () => {
    expect(sentryGetIssueDetailsSchema.required).toEqual(['issueId'])
    const optionalLimitKeys = [
      'eventsLimit',
      'tagValuesLimit',
      'commentsLimit',
      'releasesLimit',
      'commitsLimit',
    ] as const
    for (const key of optionalLimitKeys) {
      expect(sentryGetIssueDetailsSchema.properties[key]).toEqual(sentryGetProjectsSchema.properties.limit)
    }
  })
})
