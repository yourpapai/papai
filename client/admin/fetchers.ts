// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { AdminLlmSnapshot, AdminSystemSummary } from '../shared/api-types.js'
import { readBody, requireOk } from '../shared/fetcher-helpers.js'

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

const AdminSystemSummarySchema = z.object({
  chatProvider: z.string().nullable(),
  taskProvider: z.string().nullable(),
  debugServer: z.boolean(),
  adminUserSet: z.boolean(),
})

const AdminLlmKeySchema = z.enum(['llm_apikey', 'llm_baseurl', 'main_model', 'small_model', 'embedding_model'])

const SubmitAdminLlmResponseSchema = z.object({
  ok: z.literal(true),
  key: AdminLlmKeySchema,
  updatedAt: z.number(),
})

export type SubmitAdminLlmInput = {
  readonly key: z.infer<typeof AdminLlmKeySchema>
  readonly value: string
}

export type SubmitAdminLlmResult = z.infer<typeof SubmitAdminLlmResponseSchema>

export const fetchAdminLlm = async (): Promise<AdminLlmSnapshot> => {
  const res = await fetch('/admin/llm')
  const body = await readBody(res)
  requireOk(res, body)
  return AdminLlmSnapshotSchema.parse(body)
}

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

export const fetchAdminSystem = async (): Promise<AdminSystemSummary> => {
  const res = await fetch('/admin/system')
  const body = await readBody(res)
  requireOk(res, body)
  return AdminSystemSummarySchema.parse(body)
}
