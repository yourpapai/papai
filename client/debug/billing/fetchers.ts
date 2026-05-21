// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { readBody, requireOk } from '../../shared/fetcher-helpers.js'
import type { BillingDetail, BillingSubject, BillingWindow } from '../dashboard-types.js'

const BillingRoleTotalsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  calls: z.number(),
})

const BillingSubjectSchema = z.object({
  storageContextId: z.string(),
  contextType: z.enum(['dm', 'group']),
  displayName: z.string().nullable(),
  totals: z.object({
    main: BillingRoleTotalsSchema,
    small: BillingRoleTotalsSchema,
    embedding: BillingRoleTotalsSchema,
  }),
  toolCalls: z.number(),
  lastActiveAt: z.number(),
})

const BillingRequestRowSchema = z.object({
  eventId: z.string(),
  occurredAt: z.number(),
  turnId: z.string().nullable(),
  chatUserId: z.string(),
  model: z.string(),
  modelRole: z.enum(['main', 'small', 'embedding']),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  stepCount: z.number(),
  toolCallCount: z.number(),
  messageCount: z.number(),
  durationMs: z.number(),
  finishReason: z.string().nullable(),
  error: z.string().nullable(),
})

const BillingWindowSchema = z.enum(['24h', '7d', '30d', 'all'])

const BillingSubjectsResponseSchema = z.object({
  window: BillingWindowSchema,
  subjects: z.array(BillingSubjectSchema),
})

const BillingDetailResponseSchema = z.object({
  window: BillingWindowSchema,
  subject: BillingSubjectSchema,
  requests: z.array(BillingRequestRowSchema),
  truncated: z.boolean(),
})

export type FetchBillingSubjectsResult = {
  window: BillingWindow
  subjects: BillingSubject[]
}

export const fetchBillingSubjects = async (window: BillingWindow): Promise<FetchBillingSubjectsResult> => {
  const res = await fetch(`/billing/subjects?window=${encodeURIComponent(window)}`)
  const body = await readBody(res)
  requireOk(res, body)
  return BillingSubjectsResponseSchema.parse(body)
}

export type FetchBillingDetailResult = BillingDetail & { window: BillingWindow }

export const fetchBillingDetail = async (
  storageContextId: string,
  window: BillingWindow,
): Promise<FetchBillingDetailResult> => {
  const path = `/billing/subject/${encodeURIComponent(storageContextId)}?window=${encodeURIComponent(window)}`
  const res = await fetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return BillingDetailResponseSchema.parse(body)
}
