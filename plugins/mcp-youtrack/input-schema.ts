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

const fieldValue = {
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'number' }] } },
  ],
} as const

export const youtrackCreateIssueSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', minLength: 1, description: 'Project short name or id' },
    summary: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    customFields: {
      type: 'object',
      additionalProperties: fieldValue,
      description: 'Custom field name → value',
    },
    referenceIssueId: { type: 'string', description: 'Issue to resolve custom-field types from' },
  },
  required: ['project', 'summary'],
  additionalProperties: false,
} as const

export const youtrackUpdateFieldsSchema = {
  type: 'object',
  properties: {
    issueId,
    fields: {
      type: 'object',
      additionalProperties: fieldValue,
      minProperties: 1,
      description: 'Field name → value',
    },
  },
  required: ['issueId', 'fields'],
  additionalProperties: false,
} as const

export const youtrackAddIssueTagSchema = {
  type: 'object',
  properties: {
    issueId,
    tagName: { type: 'string', minLength: 1 },
  },
  required: ['issueId', 'tagName'],
  additionalProperties: false,
} as const

export const youtrackRemoveIssueTagSchema = {
  type: 'object',
  properties: {
    issueId,
    tagName: { type: 'string', minLength: 1 },
  },
  required: ['issueId', 'tagName'],
  additionalProperties: false,
} as const

export const youtrackSetTagsSchema = {
  type: 'object',
  properties: {
    issueId,
    tags: { type: 'array', items: { type: 'string', minLength: 1 }, description: 'Exact desired tag set' },
  },
  required: ['issueId', 'tags'],
  additionalProperties: false,
} as const

export const youtrackSetIssueLinkSchema = {
  type: 'object',
  properties: {
    sourceIssueId: { type: 'string', minLength: 1 },
    targetIssueId: { type: 'string', minLength: 1 },
    linkType: { type: 'string', minLength: 1 },
    direction: { type: 'string', enum: ['sourceToTarget', 'targetToSource'] },
  },
  required: ['sourceIssueId', 'targetIssueId', 'linkType', 'direction'],
  additionalProperties: false,
} as const
