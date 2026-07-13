// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  youtrackAddCommentSchema,
  youtrackAddIssueTagSchema,
  youtrackCreateIssueSchema,
  youtrackGetAttachmentsSchema,
  youtrackGetCommentsSchema,
  youtrackGetFieldOptionsSchema,
  youtrackGetIssueSchema,
  youtrackGetIssueTagsSchema,
  youtrackGetStateActivitiesSchema,
  youtrackReadAttachmentSchema,
  youtrackRemoveIssueTagSchema,
  youtrackSetIssueLinkSchema,
  youtrackSetTagsSchema,
  youtrackUpdateFieldsSchema,
} from '../../plugins/mcp-youtrack/input-schema.js'

// papai does not locally validate plugin MCP tool inputs at runtime: the plugin
// bridge (src/plugins/input-schema.ts) wraps these raw JSON-Schema objects with the
// `ai` SDK's `jsonSchema()` helper, which performs no validation of its own (that's
// left to the model/provider). So these tests assert the declared contract of each
// schema — required fields, closed shape — rather than simulating validation
// behavior that never runs in production.
describe('mcp-youtrack schemas', () => {
  test('get_issue requires issueId and rejects unknown properties', () => {
    expect(youtrackGetIssueSchema.required).toContain('issueId')
    expect(youtrackGetIssueSchema.additionalProperties).toBe(false)
  })

  test('get_state_activities requires issueId', () => {
    expect(youtrackGetStateActivitiesSchema.required).toContain('issueId')
  })

  test('get_comments requires issueId', () => {
    expect(youtrackGetCommentsSchema.required).toContain('issueId')
  })

  test('get_issue_tags requires issueId', () => {
    expect(youtrackGetIssueTagsSchema.required).toContain('issueId')
  })

  test('get_field_options requires issueId, treats fieldName as optional filter', () => {
    expect(youtrackGetFieldOptionsSchema.required).toContain('issueId')
    expect(youtrackGetFieldOptionsSchema.required).not.toContain('fieldName')
    expect(youtrackGetFieldOptionsSchema.properties.fieldName).toBeDefined()
  })

  test('get_attachments requires issueId', () => {
    expect(youtrackGetAttachmentsSchema.required).toContain('issueId')
  })

  test('read_attachment requires issueId and attachmentId', () => {
    expect(youtrackReadAttachmentSchema.required).toContain('issueId')
    expect(youtrackReadAttachmentSchema.required).toContain('attachmentId')
  })

  test('add_comment requires issueId and text', () => {
    expect(youtrackAddCommentSchema.required).toContain('issueId')
    expect(youtrackAddCommentSchema.required).toContain('text')
  })

  test('create_issue requires project and summary, allows customFields object', () => {
    expect(youtrackCreateIssueSchema.required).toContain('project')
    expect(youtrackCreateIssueSchema.required).toContain('summary')
    expect(youtrackCreateIssueSchema.properties.customFields.type).toBe('object')
  })

  test('update_fields requires issueId and fields', () => {
    expect(youtrackUpdateFieldsSchema.required).toContain('issueId')
    expect(youtrackUpdateFieldsSchema.required).toContain('fields')
  })

  test('add_issue_tag requires issueId and tagName', () => {
    expect(youtrackAddIssueTagSchema.required).toContain('issueId')
    expect(youtrackAddIssueTagSchema.required).toContain('tagName')
  })

  test('remove_issue_tag requires issueId and tagName', () => {
    expect(youtrackRemoveIssueTagSchema.required).toContain('issueId')
    expect(youtrackRemoveIssueTagSchema.required).toContain('tagName')
  })

  test('set_tags requires issueId and tags, tags is an array', () => {
    expect(youtrackSetTagsSchema.required).toContain('issueId')
    expect(youtrackSetTagsSchema.required).toContain('tags')
    expect(youtrackSetTagsSchema.properties.tags.type).toBe('array')
  })

  test('set_issue_link requires all four fields and constrains direction', () => {
    expect(youtrackSetIssueLinkSchema.required).toContain('sourceIssueId')
    expect(youtrackSetIssueLinkSchema.required).toContain('targetIssueId')
    expect(youtrackSetIssueLinkSchema.required).toContain('linkType')
    expect(youtrackSetIssueLinkSchema.required).toContain('direction')
    expect(youtrackSetIssueLinkSchema.properties.direction.enum).toEqual(['sourceToTarget', 'targetToSource'])
  })
})
