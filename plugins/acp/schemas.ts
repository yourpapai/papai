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
  },
  required: ['project', 'prompt'],
  additionalProperties: false,
} as const
