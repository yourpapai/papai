// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

// --- Condition fields and operators ---

export const CONDITION_FIELDS = [
  'task.id',
  'task.status',
  'task.priority',
  'task.assignee',
  'task.dueDate',
  'task.project',
  'task.labels',
] as const

export type ConditionField = (typeof CONDITION_FIELDS)[number]

export const FIELD_OPERATORS: Record<ConditionField, readonly string[]> = {
  'task.id': ['eq'],
  'task.status': ['eq', 'neq', 'changed_to'],
  'task.priority': ['eq', 'neq', 'changed_to'],
  'task.assignee': ['eq', 'neq', 'changed_to'],
  'task.dueDate': ['eq', 'lt', 'gt', 'overdue'],
  'task.project': ['eq', 'neq'],
  'task.labels': ['contains', 'not_contains'],
}

// --- Alert condition schema (recursive) ---

const conditionFieldSchema = z
  .enum(CONDITION_FIELDS)
  .describe(
    'Task field to watch. Use task.id with eq to watch one specific task (per-task watch); all other fields filter across every task.',
  )

const leafConditionSchema = z
  .object({
    field: conditionFieldSchema,
    op: z.string(),
    value: z.union([z.string(), z.number()]).optional(),
  })
  .superRefine((data, ctx) => {
    const validOps = FIELD_OPERATORS[data.field]
    if (!validOps.includes(data.op)) {
      ctx.addIssue({
        code: 'custom',
        message: `Invalid operator '${data.op}' for field '${data.field}'. Valid operators: ${validOps.join(', ')}`,
        path: ['op'],
      })
    }
    const valuelessOps = new Set(['overdue'])
    if (!valuelessOps.has(data.op) && data.value === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: `Operator '${data.op}' requires a value.`,
        path: ['value'],
      })
    }
  })

export type LeafCondition = z.infer<typeof leafConditionSchema>

const activityLeafSchema = z.object({
  kind: z.literal('activity'),
  taskId: z.string({ error: 'Activity conditions require a taskId.' }),
  categories: z.array(z.string()).optional(),
})

export type ActivityLeafCondition = z.output<typeof activityLeafSchema>

type AndCondition = { and: AlertCondition[] }
type OrCondition = { or: AlertCondition[] }

export type AlertCondition = LeafCondition | ActivityLeafCondition | AndCondition | OrCondition

export const alertConditionSchema: z.ZodType<AlertCondition> = z
  .union([
    leafConditionSchema,
    activityLeafSchema,
    z.object({
      and: z.lazy(() => z.array(alertConditionSchema).min(1)),
    }),
    z.object({
      or: z.lazy(() => z.array(alertConditionSchema).min(1)),
    }),
  ])
  .describe(
    'Event-based trigger: watch task fields across tasks, or new activity entries on one task (kind: "activity" with a taskId).',
  )
