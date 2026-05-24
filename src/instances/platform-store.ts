// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { eq } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { platformInstances } from '../db/schema.js'
import { logger } from '../logger.js'
import { decryptInstanceConfig, encryptInstanceConfig } from './encryption.js'
import type { InstanceConfig, InstanceStatus, PlatformInstance, PlatformInstanceType } from './types.js'

const log = logger.child({ scope: 'instances:platform-store' })

const PLATFORM_INSTANCE_TYPES: readonly PlatformInstanceType[] = ['telegram', 'mattermost', 'discord']
const INSTANCE_STATUSES: readonly InstanceStatus[] = ['pending', 'active', 'stopped']

export interface InsertPlatformInstanceInput {
  id: string
  type: PlatformInstanceType
  config: InstanceConfig
  status: InstanceStatus
}

export interface UpdatePlatformInstanceInput {
  config: InstanceConfig | undefined
  status: InstanceStatus | undefined
}

const parsePlatformInstanceType = (value: string): PlatformInstanceType => {
  const match = PLATFORM_INSTANCE_TYPES.find((candidate) => candidate === value)
  if (match === undefined) throw new Error(`unknown platform instance type stored: ${value}`)
  return match
}

const parseInstanceStatus = (value: string): InstanceStatus => {
  const match = INSTANCE_STATUSES.find((candidate) => candidate === value)
  if (match === undefined) throw new Error(`unknown instance status stored: ${value}`)
  return match
}

const rowToInstance = (row: typeof platformInstances.$inferSelect): PlatformInstance => ({
  id: row.id,
  type: parsePlatformInstanceType(row.type),
  config: decryptInstanceConfig(row.config),
  status: parseInstanceStatus(row.status),
  createdAt: row.createdAt,
})

export const insertPlatformInstance = (input: InsertPlatformInstanceInput): void => {
  getDrizzleDb()
    .insert(platformInstances)
    .values({
      id: input.id,
      type: input.type,
      config: encryptInstanceConfig(input.config),
      status: input.status,
    })
    .run()
  log.info({ id: input.id, type: input.type, status: input.status }, 'platform instance inserted')
}

export const getPlatformInstance = (id: string): PlatformInstance | null => {
  const row = getDrizzleDb().select().from(platformInstances).where(eq(platformInstances.id, id)).get()
  return row === undefined ? null : rowToInstance(row)
}

export const listPlatformInstances = (): PlatformInstance[] => {
  const rows = getDrizzleDb().select().from(platformInstances).all()
  return rows.map((row) => rowToInstance(row))
}

export const listActivePlatformInstances = (): PlatformInstance[] =>
  listPlatformInstances().filter((instance) => instance.status === 'active')

export const updatePlatformInstance = (id: string, patch: UpdatePlatformInstanceInput): void => {
  const set: Partial<typeof platformInstances.$inferInsert> = {}
  if (patch.config !== undefined) set.config = encryptInstanceConfig(patch.config)
  if (patch.status !== undefined) set.status = patch.status
  if (Object.keys(set).length === 0) return
  getDrizzleDb().update(platformInstances).set(set).where(eq(platformInstances.id, id)).run()
  log.info({ id, updated: Object.keys(set) }, 'platform instance updated')
}

export const deletePlatformInstance = (id: string): void => {
  getDrizzleDb().delete(platformInstances).where(eq(platformInstances.id, id)).run()
  log.info({ id }, 'platform instance deleted')
}
