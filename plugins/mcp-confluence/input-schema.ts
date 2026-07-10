// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const confluenceGetPageSchema = {
  type: 'object',
  properties: { pageId: { type: 'string', minLength: 1, description: 'Confluence page id' } },
  required: ['pageId'],
  additionalProperties: false,
} as const

export const confluenceGetPageByTitleSchema = {
  type: 'object',
  properties: {
    spaceKey: { type: 'string', minLength: 1, description: 'Space key, e.g. TEAM' },
    title: { type: 'string', minLength: 1, description: 'Exact page title' },
  },
  required: ['spaceKey', 'title'],
  additionalProperties: false,
} as const

export const confluenceGetCommentsSchema = {
  type: 'object',
  properties: { pageId: { type: 'string', minLength: 1, description: 'Confluence page id' } },
  required: ['pageId'],
  additionalProperties: false,
} as const

export const confluenceAddCommentSchema = {
  type: 'object',
  properties: {
    pageId: { type: 'string', minLength: 1, description: 'Confluence page id' },
    text: { type: 'string', minLength: 1, description: 'Comment body in Confluence storage (XHTML) format' },
  },
  required: ['pageId', 'text'],
  additionalProperties: false,
} as const

export const confluenceResolveShortLinkSchema = {
  type: 'object',
  properties: {
    shortLink: { type: 'string', minLength: 1, description: 'Confluence tiny link (full URL or /x/<key>)' },
  },
  required: ['shortLink'],
  additionalProperties: false,
} as const
