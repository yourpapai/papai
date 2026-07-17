// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

export const emptySchema = z.object({})

export const startSessionSchema = z.object({
  project: z.string().describe('Project name to run the session against.'),
  prompt: z.string().describe('Task prompt for the coding agent.'),
  agent: z.string().describe('Agent identifier to use (defaults to claude-code-acp).').optional(),
  prNumber: z
    .number()
    .int()
    .describe('Optional existing PR/MR number to start the session on (review or edit its branch).')
    .optional(),
})

export const listSessionsSchema = z.object({
  filter: z
    .enum(['new', 'active', 'waiting', 'done'])
    .describe('Which sessions to list; defaults to active')
    .optional(),
})

export const sessionIdSchema = z.object({
  sessionId: z.string().describe('magi session id'),
})

export const finishSessionSchema = z.object({
  sessionId: z.string(),
  action: z.enum(['push', 'pr']).describe('push the branch, or open a PR'),
  message: z.string().describe('Commit message; defaults to a generic message').optional(),
  title: z.string().describe('PR title (action=pr)').optional(),
  body: z.string().describe('PR body (action=pr)').optional(),
})

export const answerPermissionSchema = z.object({
  sessionId: z.string(),
  decision: z.enum(['allow', 'deny']),
})

export const continueSessionSchema = z.object({
  sessionId: z.string().describe('A prior session id to continue.').optional(),
  prNumber: z.number().int().describe('A prior PR/MR number to continue (with project).').optional(),
  project: z.string().describe('Project name (required when using prNumber).').optional(),
  prompt: z.string().describe('What to do next on the existing branch/PR.'),
})
