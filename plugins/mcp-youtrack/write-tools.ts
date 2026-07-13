// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { HttpFetch, PluginToolRuntimeContextLike } from './context.js'
import {
  readDirection,
  readOptionalString,
  readRecord,
  readRequiredRecord,
  readRequiredString,
  readStringArray,
  toRecord,
  withYouTrackWriteGuards,
  type YouTrackToolDefinition,
} from './guards.js'
import {
  youtrackAddIssueTagSchema,
  youtrackCreateIssueSchema,
  youtrackRemoveIssueTagSchema,
  youtrackSetIssueLinkSchema,
  youtrackSetTagsSchema,
  youtrackUpdateFieldsSchema,
} from './input-schema.js'

function executeCreateIssue(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackWriteGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.createIssue({
      project: readRequiredString(record, 'project'),
      summary: readRequiredString(record, 'summary'),
      description: readOptionalString(record, 'description'),
      customFields: readRecord(record, 'customFields'),
      referenceIssueId: readOptionalString(record, 'referenceIssueId'),
    })
  })
}

function executeUpdateFields(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackWriteGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    const issueId = readRequiredString(record, 'issueId')
    const fields = readRequiredRecord(record, 'fields')
    return client.updateFields(issueId, fields)
  })
}

function executeAddIssueTag(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackWriteGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.addIssueTag(readRequiredString(record, 'issueId'), readRequiredString(record, 'tagName'))
  })
}

function executeRemoveIssueTag(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackWriteGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    return client.removeIssueTag(readRequiredString(record, 'issueId'), readRequiredString(record, 'tagName'))
  })
}

function executeSetTags(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackWriteGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    const issueId = readRequiredString(record, 'issueId')
    const tags = readStringArray(record, 'tags')
    return client.setTags(issueId, tags)
  })
}

function executeSetIssueLink(
  input: unknown,
  runtimeContext: PluginToolRuntimeContextLike,
  httpFetch: HttpFetch | undefined,
): Promise<unknown> {
  return withYouTrackWriteGuards(runtimeContext, httpFetch, (client) => {
    const record = toRecord(input)
    const sourceIssueId = readRequiredString(record, 'sourceIssueId')
    const targetIssueId = readRequiredString(record, 'targetIssueId')
    const linkType = readRequiredString(record, 'linkType')
    const direction = readDirection(record, 'direction')
    return client.setIssueLink(sourceIssueId, targetIssueId, linkType, direction)
  })
}

export function buildWriteToolDefinitions(getHttpFetch: () => HttpFetch | undefined): YouTrackToolDefinition[] {
  return [
    {
      name: 'youtrack_create_issue',
      description: 'WRITE: create a new YouTrack issue (mutates YouTrack)',
      inputSchema: youtrackCreateIssueSchema,
      execute: (input, runtimeContext) => executeCreateIssue(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_update_fields',
      description: 'WRITE: update one or more custom fields on a YouTrack issue (mutates YouTrack)',
      inputSchema: youtrackUpdateFieldsSchema,
      execute: (input, runtimeContext) => executeUpdateFields(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_add_issue_tag',
      description: 'WRITE: add a tag to a YouTrack issue (mutates YouTrack)',
      inputSchema: youtrackAddIssueTagSchema,
      execute: (input, runtimeContext) => executeAddIssueTag(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_remove_issue_tag',
      description: 'WRITE: remove a tag from a YouTrack issue (mutates YouTrack)',
      inputSchema: youtrackRemoveIssueTagSchema,
      execute: (input, runtimeContext) => executeRemoveIssueTag(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_set_tags',
      description: 'WRITE: set the exact tag set on a YouTrack issue, adding/removing as needed (mutates YouTrack)',
      inputSchema: youtrackSetTagsSchema,
      execute: (input, runtimeContext) => executeSetTags(input, runtimeContext, getHttpFetch()),
    },
    {
      name: 'youtrack_set_issue_link',
      description: 'WRITE: link two YouTrack issues with a given link type and direction (mutates YouTrack)',
      inputSchema: youtrackSetIssueLinkSchema,
      execute: (input, runtimeContext) => executeSetIssueLink(input, runtimeContext, getHttpFetch()),
    },
  ]
}
