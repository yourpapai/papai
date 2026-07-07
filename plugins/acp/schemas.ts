// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const emptySchema = { type: 'object', properties: {}, additionalProperties: false } as const

export const startSessionSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Project name to run the session against.' },
    prompt: { type: 'string', description: 'Task prompt for the coding agent.' },
    agent: { type: 'string', description: 'Agent identifier to use (defaults to claude-code-acp).' },
    prNumber: {
      type: 'integer',
      description: 'Optional existing PR/MR number to start the session on (review or edit its branch).',
    },
  },
  required: ['project', 'prompt'],
  additionalProperties: false,
} as const

export const listSessionsSchema = {
  type: 'object',
  properties: {
    filter: {
      type: 'string',
      enum: ['new', 'active', 'waiting', 'review', 'done'],
      description: 'Which sessions to list; defaults to active',
    },
  },
  additionalProperties: false,
} as const

export const sessionIdSchema = {
  type: 'object',
  properties: { sessionId: { type: 'string', description: 'magi session id' } },
  required: ['sessionId'],
  additionalProperties: false,
} as const

export const finishSessionSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string' },
    action: { type: 'string', enum: ['push', 'pr'], description: 'push the branch, or open a PR' },
    message: { type: 'string', description: 'Commit message; defaults to a generic message' },
    title: { type: 'string', description: 'PR title (action=pr)' },
    body: { type: 'string', description: 'PR body (action=pr)' },
  },
  required: ['sessionId', 'action'],
  additionalProperties: false,
} as const

export const answerPermissionSchema = {
  type: 'object',
  properties: { sessionId: { type: 'string' }, decision: { type: 'string', enum: ['allow', 'deny'] } },
  required: ['sessionId', 'decision'],
  additionalProperties: false,
} as const

export const reviewPrSchema = {
  type: 'object',
  properties: { project: { type: 'string' }, prNumber: { type: 'integer', description: 'Pull/merge request number' } },
  required: ['project', 'prNumber'],
  additionalProperties: false,
} as const

export const continueSessionSchema = {
  type: 'object',
  properties: {
    sessionId: { type: 'string', description: 'A prior session id to continue.' },
    prNumber: { type: 'integer', description: 'A prior PR/MR number to continue (with project).' },
    project: { type: 'string', description: 'Project name (required when using prNumber).' },
    prompt: { type: 'string', description: 'What to do next on the existing branch/PR.' },
  },
  required: ['prompt'],
  additionalProperties: false,
} as const
