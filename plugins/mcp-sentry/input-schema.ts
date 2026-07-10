// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

const limit = { type: 'integer', minimum: 1, maximum: 100, description: 'Max results (1-100)' } as const

export const sentryGetProjectsSchema = {
  type: 'object',
  properties: { limit },
  additionalProperties: false,
} as const

export const sentrySearchIssuesSchema = {
  type: 'object',
  properties: {
    project: { type: 'string' },
    query: { type: 'string', description: 'Sentry search query' },
    statsPeriod: { type: 'string', description: 'e.g. 24h, 14d' },
    environment: { type: 'string' },
    sort: { type: 'string', enum: ['date', 'freq', 'new', 'priority', 'user'] },
    limit,
  },
  additionalProperties: false,
} as const

export const sentryGetIssueSchema = {
  type: 'object',
  properties: { issueId: { type: 'string', minLength: 1 } },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const sentryGetIssueEventsSchema = {
  type: 'object',
  properties: { issueId: { type: 'string', minLength: 1 }, limit },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const sentryGetIssueTagValuesSchema = {
  type: 'object',
  properties: { issueId: { type: 'string', minLength: 1 }, tagKey: { type: 'string', minLength: 1 }, limit },
  required: ['issueId', 'tagKey'],
  additionalProperties: false,
} as const

export const sentryGetIssueCommentsSchema = {
  type: 'object',
  properties: { issueId: { type: 'string', minLength: 1 }, limit },
  required: ['issueId'],
  additionalProperties: false,
} as const

export const sentryGetIssueDetailsSchema = {
  type: 'object',
  properties: {
    issueId: { type: 'string', minLength: 1 },
    eventsLimit: limit,
    tagValuesLimit: limit,
    commentsLimit: limit,
    releasesLimit: limit,
    commitsLimit: limit,
  },
  required: ['issueId'],
  additionalProperties: false,
} as const
