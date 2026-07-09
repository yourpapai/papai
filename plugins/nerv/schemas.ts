// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export const emptySchema = { type: 'object', properties: {}, additionalProperties: false } as const

export const createCodingTaskSchema = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'A configured repository name to supervise (single repo).' },
    projects: {
      type: 'array',
      items: { type: 'string' },
      description: 'Multiple repository names for a multi-repo task (alternative to project).',
    },
    prompt: { type: 'string', description: 'What the coding task should accomplish.' },
    kind: { type: 'string', description: 'Task kind; defaults to gitlab-mr-supervision.' },
    costBudgetUsd: { type: 'number', description: 'Optional USD cost budget for the task.' },
  },
  required: ['prompt'],
  additionalProperties: false,
} as const

interface OptionalTaskIdSchema {
  readonly type: 'object'
  readonly properties: { readonly taskId: { readonly type: 'string'; readonly description: string } }
  readonly required?: readonly string[]
  readonly additionalProperties: false
}

export const taskRefSchema: OptionalTaskIdSchema = {
  type: 'object',
  properties: {
    taskId: { type: 'string', description: "Optional nerv task id; defaults to this thread's current task." },
  },
  additionalProperties: false,
}

export const cancelSchema = taskRefSchema

export const followupSchema = {
  type: 'object',
  properties: {
    taskId: { type: 'string', description: "Optional nerv task id; defaults to this thread's current task." },
    text: { type: 'string', description: 'Instruction to send to the running task.' },
  },
  required: ['text'],
  additionalProperties: false,
} as const
