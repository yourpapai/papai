// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { AdminLlmSnapshot, BillingDetail, BillingSubject, BillingWindow } from '../dashboard-types.js'

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

const AdminLlmKeyStateSchema = z.object({
  value: z.string().nullable(),
  updatedAt: z.number().nullable(),
  updatedBy: z.string().nullable(),
})

const AdminLlmSnapshotSchema = z.object({
  llm_apikey: AdminLlmKeyStateSchema,
  llm_baseurl: AdminLlmKeyStateSchema,
  main_model: AdminLlmKeyStateSchema,
  small_model: AdminLlmKeyStateSchema,
  embedding_model: AdminLlmKeyStateSchema,
})

const ErrorBodySchema = z.object({ error: z.string() })

const SubmitAdminLlmResponseSchema = z.object({
  ok: z.literal(true),
  key: z.enum(['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model']),
  updatedAt: z.number(),
})

const errorMessageFrom = (body: unknown, fallback: string): string => {
  const parsed = ErrorBodySchema.safeParse(body)
  return parsed.success ? parsed.data.error : fallback
}

const readBody = async (res: Response): Promise<unknown> => {
  try {
    return await res.json()
  } catch {
    return null
  }
}

const requireOk = (res: Response, body: unknown): void => {
  if (res.ok) return
  throw new Error(errorMessageFrom(body, `request failed with status ${res.status}`))
}

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

export const fetchAdminLlm = async (): Promise<AdminLlmSnapshot> => {
  const res = await fetch('/admin/llm')
  const body = await readBody(res)
  requireOk(res, body)
  return AdminLlmSnapshotSchema.parse(body)
}

export type SubmitAdminLlmInput = {
  key: 'llm_apikey' | 'llm_baseurl' | 'main_model' | 'small_model' | 'embedding_model'
  value: string
}

export type SubmitAdminLlmResult = z.infer<typeof SubmitAdminLlmResponseSchema>

export const submitAdminLlm = async (input: SubmitAdminLlmInput): Promise<SubmitAdminLlmResult> => {
  const res = await fetch('/admin/llm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const body = await readBody(res)
  requireOk(res, body)
  return SubmitAdminLlmResponseSchema.parse(body)
}
