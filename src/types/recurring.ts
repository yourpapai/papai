// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

export type TriggerType = 'cron' | 'on_complete'

export type RecurringTaskInput = {
  userId: string
  projectId: string
  title: string
  description?: string
  priority?: string
  status?: string
  assignee?: string
  labels?: string[]
  triggerType: TriggerType
  rrule?: string
  dtstartUtc?: string
  timezone?: string
  catchUp?: boolean
}

export type RecurringTaskRecord = {
  id: string
  userId: string
  projectId: string
  title: string
  description: string | null
  priority: string | null
  status: string | null
  assignee: string | null
  labels: string[]
  triggerType: TriggerType
  rrule: string | null
  dtstartUtc: string | null
  timezone: string
  enabled: boolean
  catchUp: boolean
  lastRun: string | null
  nextRun: string | null
  createdAt: string
  updatedAt: string
}
