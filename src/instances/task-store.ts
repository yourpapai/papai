// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { taskInstances } from '../db/schema.js'
import { logger } from '../logger.js'
import { decryptInstanceConfig, encryptInstanceConfig } from './encryption.js'
import type { InstanceConfig, InstanceStatus, TaskInstance, TaskInstanceType } from './types.js'

const log = logger.child({ scope: 'instances:task-store' })

const TASK_INSTANCE_TYPES: readonly TaskInstanceType[] = ['kaneo', 'youtrack']
const INSTANCE_STATUSES: readonly InstanceStatus[] = ['pending', 'active', 'stopped']

export interface InsertTaskInstanceInput {
  id: string
  type: TaskInstanceType
  config: InstanceConfig
  status: InstanceStatus
}

export interface UpdateTaskInstanceInput {
  config: InstanceConfig | undefined
  status: InstanceStatus | undefined
}

const parseTaskInstanceType = (value: string): TaskInstanceType => {
  const match = TASK_INSTANCE_TYPES.find((candidate) => candidate === value)
  if (match === undefined) throw new Error(`unknown task instance type stored: ${value}`)
  return match
}

const parseInstanceStatus = (value: string): InstanceStatus => {
  const match = INSTANCE_STATUSES.find((candidate) => candidate === value)
  if (match === undefined) throw new Error(`unknown instance status stored: ${value}`)
  return match
}

const rowToInstance = (row: typeof taskInstances.$inferSelect): TaskInstance => ({
  id: row.id,
  type: parseTaskInstanceType(row.type),
  config: decryptInstanceConfig(row.config),
  status: parseInstanceStatus(row.status),
  createdAt: row.createdAt,
})

export const insertTaskInstance = (input: InsertTaskInstanceInput): void => {
  getDrizzleDb()
    .insert(taskInstances)
    .values({
      id: input.id,
      type: input.type,
      config: encryptInstanceConfig(input.config),
      status: input.status,
    })
    .run()
  log.info({ id: input.id, type: input.type, status: input.status }, 'task instance inserted')
}

export const getTaskInstance = (id: string): TaskInstance | null => {
  const row = getDrizzleDb().select().from(taskInstances).where(eq(taskInstances.id, id)).get()
  return row === undefined ? null : rowToInstance(row)
}

export const listTaskInstances = (): TaskInstance[] => {
  const rows = getDrizzleDb().select().from(taskInstances).all()
  return rows.map((row) => rowToInstance(row))
}

export const updateTaskInstance = (id: string, patch: UpdateTaskInstanceInput): void => {
  const set: Partial<typeof taskInstances.$inferInsert> = {}
  if (patch.config !== undefined) set.config = encryptInstanceConfig(patch.config)
  if (patch.status !== undefined) set.status = patch.status
  if (Object.keys(set).length === 0) return
  getDrizzleDb().update(taskInstances).set(set).where(eq(taskInstances.id, id)).run()
  log.info({ id, updated: Object.keys(set) }, 'task instance updated')
}

export const deleteTaskInstance = (id: string): void => {
  getDrizzleDb().delete(taskInstances).where(eq(taskInstances.id, id)).run()
  log.info({ id }, 'task instance deleted')
}
