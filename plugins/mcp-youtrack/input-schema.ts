// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const issueId = { type: 'string', minLength: 1, description: 'YouTrack issue id, e.g. "PROJ-123"' } as const

export const youtrackGetIssueSchema = {
  type: 'object',
  properties: { issueId },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const youtrackGetStateActivitiesSchema = {
  type: 'object',
  properties: { issueId },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const youtrackGetCommentsSchema = {
  type: 'object',
  properties: { issueId },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const youtrackGetIssueTagsSchema = {
  type: 'object',
  properties: { issueId },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const youtrackGetFieldOptionsSchema = {
  type: 'object',
  properties: {
    issueId,
    fieldName: { type: 'string', description: 'Custom field name to filter to' },
  },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const youtrackGetAttachmentsSchema = {
  type: 'object',
  properties: { issueId },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const youtrackReadAttachmentSchema = {
  type: 'object',
  properties: {
    issueId,
    attachmentId: { type: 'string', minLength: 1, description: 'Attachment id from get_attachments' },
  },
  required: ['issueId', 'attachmentId'],
  additionalProperties: false,
} as const

export const youtrackAddCommentSchema = {
  type: 'object',
  properties: {
    issueId,
    text: { type: 'string', minLength: 1, description: 'Comment text' },
  },
  required: ['issueId', 'text'],
  additionalProperties: false,
} as const
