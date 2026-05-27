// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import type { GlobalStats, StatsWindow, SubjectStats } from '../../src/stats/types.js'
import type {
  AdminLlmSnapshot,
  AdminSystemSummary,
  AuthorizedGroupEntry,
  BillingDetail,
  BillingSubject,
  BillingWindow,
  DeferredPrompt,
  IdentityMappingEntry,
  Memo,
  RecurringTask,
} from '../shared/api-types.js'
import { readBody, requireOk } from '../shared/fetcher-helpers.js'
import {
  AdminLlmSnapshotSchema,
  AdminSystemSummarySchema,
  AuthorizedGroupEntrySchema,
  BillingDetailResponseSchema,
  BillingSubjectsResponseSchema,
  DeferredPromptSchema,
  GlobalStatsSchema,
  IdentityMappingEntrySchema,
  MemoSchema,
  RecentRequestsResponseSchema,
  RecurringTaskSchema,
  SubjectStatsSchema,
  SubmitAdminLlmResponseSchema,
  type RecentRequestRow,
  type SubmitAdminLlmKey,
} from './fetcher-schemas.js'

export * from './instance-fetchers.js'

export type SubmitAdminLlmInput = {
  readonly key: SubmitAdminLlmKey
  readonly value: string
}

export type SubmitAdminLlmResult = z.infer<typeof SubmitAdminLlmResponseSchema>

export type FetchBillingSubjectsResult = {
  readonly window: BillingWindow
  readonly subjects: BillingSubject[]
}

export type FetchBillingDetailResult = BillingDetail & { readonly window: BillingWindow }

export const fetchStatsGlobal = async (window: StatsWindow | undefined): Promise<GlobalStats> => {
  const path = window === undefined ? '/stats/global' : `/stats/global?window=${encodeURIComponent(window)}`
  const res = await fetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return GlobalStatsSchema.parse(body) as GlobalStats
}

export const fetchBillingSubjects = async (window: BillingWindow): Promise<FetchBillingSubjectsResult> => {
  const res = await fetch(`/billing/subjects?window=${encodeURIComponent(window)}`)
  const body = await readBody(res)
  requireOk(res, body)
  return BillingSubjectsResponseSchema.parse(body)
}

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

export const fetchStatsSubject = async (storageContextId: string): Promise<SubjectStats> => {
  const res = await fetch(`/stats/subject/${encodeURIComponent(storageContextId)}`)
  const body = await readBody(res)
  requireOk(res, body)
  return SubjectStatsSchema.parse(body) as SubjectStats
}

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

export const fetchMemos = async (userId: string, state: 'active' | 'archived'): Promise<Memo[]> => {
  const path = `/memos?userId=${encodeURIComponent(userId)}&state=${encodeURIComponent(state)}`
  const res = await fetch(path)
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(MemoSchema).parse(body) as Memo[]
}

export const fetchRecurringTasks = async (userId: string): Promise<RecurringTask[]> => {
  const res = await fetch(`/recurring?userId=${encodeURIComponent(userId)}`)
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(RecurringTaskSchema).parse(body) as RecurringTask[]
}

export const fetchDeferredPrompts = async (userId: string): Promise<DeferredPrompt[]> => {
  const res = await fetch(`/deferred?userId=${encodeURIComponent(userId)}`)
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(DeferredPromptSchema).parse(body) as DeferredPrompt[]
}

export const fetchAdminIdentity = async (userId: string, provider: string): Promise<IdentityMappingEntry | null> => {
  const path = `/identity?userId=${encodeURIComponent(userId)}&provider=${encodeURIComponent(provider)}`
  const res = await fetch(path)
  const body = await readBody(res)
  if (res.status === 404) return null
  requireOk(res, body)
  return IdentityMappingEntrySchema.parse(body) as IdentityMappingEntry
}

export const fetchRecentRequests = async (
  subjectId: string,
  ...args: readonly [] | readonly [number]
): Promise<RecentRequestRow[]> => {
  const limit = args.length === 0 ? 25 : args[0]
  const res = await fetch(`/admin/subjects/${encodeURIComponent(subjectId)}/recent-requests?limit=${limit}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) return []
  const body = await readBody(res)
  const parsed = RecentRequestsResponseSchema.safeParse(body)
  return parsed.success ? parsed.data.requests : []
}

export const fetchAdminGroups = async (): Promise<AuthorizedGroupEntry[]> => {
  const res = await fetch('/auth/groups')
  const body = await readBody(res)
  requireOk(res, body)
  return z.array(AuthorizedGroupEntrySchema).parse(body) as AuthorizedGroupEntry[]
}
