// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { ContextType, DeferredAudience } from '../chat/types.js'
import { isValidTimezone } from '../types/recurrence.js'

// --- Delivery domain types ---

/** Domain-layer delivery spec stored with each prompt (mirrors DeferredDeliveryTarget). */
export type DeferredPromptDelivery = {
  contextId: string
  contextType: ContextType
  threadId: string | null
  audience: DeferredAudience
  mentionUserIds: string[]
  createdByUserId: string
  createdByUsername: string | null
}

/** Input shape for delivery spec at creation time (same fields as DeferredPromptDelivery). */
export type DeferredPromptDeliveryInput = DeferredPromptDelivery

/** Tool-level delivery policy schema (audience + mention targets chosen by the LLM). */
export const deliveryPolicySchema = z
  .object({
    audience: z.enum(['personal', 'shared']).describe("'personal' to @mention the creator, 'shared' for no mention"),
    mention_user_ids: z
      .array(z.string())
      .describe('User IDs to @mention in the delivery message (personal audience only)'),
  })
  .optional()
  .describe('Delivery policy for group contexts. Omit for DM prompts.')

// --- Condition fields and operators ---

export const CONDITION_FIELDS = [
  'task.status',
  'task.priority',
  'task.assignee',
  'task.dueDate',
  'task.project',
  'task.labels',
] as const

export type ConditionField = (typeof CONDITION_FIELDS)[number]

export const FIELD_OPERATORS: Record<ConditionField, readonly string[]> = {
  'task.status': ['eq', 'neq', 'changed_to'],
  'task.priority': ['eq', 'neq', 'changed_to'],
  'task.assignee': ['eq', 'neq', 'changed_to'],
  'task.dueDate': ['eq', 'lt', 'gt', 'overdue'],
  'task.project': ['eq', 'neq'],
  'task.labels': ['contains', 'not_contains'],
}

// --- Alert condition schema (recursive) ---

const conditionFieldSchema = z.enum(CONDITION_FIELDS)

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

type AndCondition = { and: AlertCondition[] }
type OrCondition = { or: AlertCondition[] }

export type AlertCondition = LeafCondition | AndCondition | OrCondition

export const alertConditionSchema: z.ZodType<AlertCondition> = z.union([
  leafConditionSchema,
  z.object({
    and: z.lazy(() => z.array(alertConditionSchema).min(1)),
  }),
  z.object({
    or: z.lazy(() => z.array(alertConditionSchema).min(1)),
  }),
])

// --- Execution metadata ---

export const EXECUTION_MODES = ['lightweight', 'context', 'full'] as const
export type ExecutionMode = (typeof EXECUTION_MODES)[number]

export const executionMetadataSchema = z.object({
  mode: z.enum(EXECUTION_MODES),
  delivery_brief: z.string(),
  context_snapshot: z.string().nullable().default(null),
})

export type ExecutionMetadata = z.infer<typeof executionMetadataSchema>

export const DEFAULT_EXECUTION_METADATA: ExecutionMetadata = {
  mode: 'full',
  delivery_brief: '',
  context_snapshot: null,
}

export function parseExecutionMetadata(raw: string): ExecutionMetadata {
  try {
    const parsed: unknown = JSON.parse(raw)
    const result = executionMetadataSchema.safeParse(parsed)
    return result.success ? result.data : DEFAULT_EXECUTION_METADATA
  } catch {
    return DEFAULT_EXECUTION_METADATA
  }
}

// --- Tool input schemas ---

export type FireAtInput = { date: string; time: string }

export const rruleInputSchema = z
  .object({
    freq: z.enum(['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']).describe('Recurrence frequency.'),
    interval: z.number().int().min(1).optional().describe('Interval between occurrences (default 1).'),
    byDay: z
      .array(z.enum(['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU']))
      .min(1)
      .optional()
      .describe('Weekdays e.g. ["MO","WE","FR"].'),
    byMonthDay: z.array(z.number().int().min(1).max(31)).min(1).optional().describe('Days of month (1–31).'),
    byMonth: z.array(z.number().int().min(1).max(12)).min(1).optional().describe('Months (1–12).'),
    byHour: z.array(z.number().int().min(0).max(23)).min(1).optional().describe('Hours in local time (0–23).'),
    byMinute: z.array(z.number().int().min(0).max(59)).min(1).optional().describe('Minutes (0–59).'),
    until: z.iso.datetime().optional().describe('End datetime in UTC ISO 8601. Mutually exclusive with count.'),
    count: z.number().int().min(1).optional().describe('Total occurrences. Mutually exclusive with until.'),
    timezone: z.string().describe('IANA timezone (e.g. "America/New_York"). Call get_current_time to obtain it.'),
    startDate: z.iso
      .date()
      .optional()
      .describe("Series anchor date in YYYY-MM-DD (user's local date). Defaults to today when omitted."),
    startTime: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM with valid hour (0-23) and minute (0-59)')
      .optional()
      .describe(
        "Series anchor time in HH:MM 24-hour format (user's local time). Requires startDate. Defaults to 00:00 when omitted.",
      ),
  })
  .refine((v) => !(v.until !== undefined && v.count !== undefined), {
    message: 'until and count are mutually exclusive',
    path: ['count'],
  })
  .refine((v) => isValidTimezone(v.timezone), {
    message: 'invalid IANA timezone',
    path: ['timezone'],
  })
  .refine((v) => !(v.startTime !== undefined && v.startDate === undefined), {
    message: 'startDate is required when startTime is provided',
    path: ['startDate'],
  })

export type RruleInput = z.infer<typeof rruleInputSchema>
export type ScheduleInput = { fire_at?: FireAtInput; rrule?: RruleInput }

export const scheduleSchema = z
  .object({
    fire_at: z
      .object({
        date: z.iso.date().describe("Date in YYYY-MM-DD format (user's local date)"),
        time: z
          .string()
          .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be HH:MM with valid hour (0-23) and minute (0-59)')
          .describe("Time in HH:MM 24-hour format (user's local time)"),
      })
      .optional()
      .describe("One-time trigger in user's local time — tool handles UTC conversion"),
    rrule: rruleInputSchema.optional().describe('Recurring schedule spec.'),
  })
  .refine((v) => !(v.fire_at !== undefined && v.rrule !== undefined), {
    message: 'fire_at and rrule are mutually exclusive — provide exactly one',
    path: ['rrule'],
  })
  .refine((v) => v.fire_at !== undefined || v.rrule !== undefined, {
    message: 'provide exactly one of fire_at or rrule',
    path: ['fire_at'],
  })

export const cooldownSchema = z
  .number()
  .int()
  .min(1)
  .optional()
  .describe('Minimum minutes between alert triggers (default: 60)')

export const executionInputSchema = z
  .object({
    mode: z
      .enum(EXECUTION_MODES)
      .describe(
        'lightweight: simple reminders/nudges needing no tools or history. context: needs conversation history but no tools. full: needs live task tracker operations.',
      ),
    delivery_brief: z
      .string()
      .describe('Freeform instructions for the executing LLM: intent, tone, key details, entities to reference.'),
    context_snapshot: z
      .string()
      .optional()
      .describe(
        'When the user references something from the current conversation, distill only the relevant parts into a summary here.',
      ),
  })
  .optional()
  .describe('Execution mode classification and delivery instructions for the firing LLM.')

// --- Domain types ---

export type ScheduledPrompt = {
  type: 'scheduled'
  id: string
  createdByUserId: string
  createdByUsername: string | null
  deliveryTarget: DeferredPromptDelivery
  prompt: string
  fireAt: string
  rrule: string | null
  dtstartUtc: string | null
  timezone: string | null
  status: 'active' | 'completed' | 'cancelled'
  createdAt: string
  lastExecutedAt: string | null
  executionMetadata: ExecutionMetadata
}

export type AlertPrompt = {
  type: 'alert'
  id: string
  createdByUserId: string
  createdByUsername: string | null
  deliveryTarget: DeferredPromptDelivery
  prompt: string
  condition: AlertCondition
  status: 'active' | 'cancelled'
  createdAt: string
  lastTriggeredAt: string | null
  cooldownMinutes: number
  executionMetadata: ExecutionMetadata
}

// --- Tool result types ---

type ToolError = { error: string }

export type CreateResult =
  | { status: 'created'; type: 'scheduled'; id: string; fireAt: string; rrule: string | null }
  | { status: 'created'; type: 'alert'; id: string; cooldownMinutes: number }
  | ToolError

export type ListResult = { prompts: Array<ScheduledPrompt | AlertPrompt> }

export type GetResult = ScheduledPrompt | AlertPrompt | ToolError

export type UpdateResult =
  | (Omit<ScheduledPrompt, 'status'> & { status: 'updated' })
  | (Omit<AlertPrompt, 'status'> & { status: 'updated' })
  | ToolError

export type CancelResult = { status: 'cancelled'; id: string } | ToolError
