// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { count } from 'drizzle-orm'

import { getDrizzleDb } from '../db/drizzle.js'
import { platformInstances, taskInstances } from '../db/schema.js'
import { logger } from '../logger.js'
import { addAdmin, SUPER_ADMIN_PLATFORM_ID } from './admin-store.js'
import { insertPlatformInstance } from './platform-store.js'
import { insertTaskInstance } from './task-store.js'
import type { BootstrapResult, InstanceConfig, PlatformInstanceType, TaskInstanceType } from './types.js'

const log = logger.child({ scope: 'instances:bootstrap' })

const CHAT_ENV_REQUIREMENTS: Readonly<Record<PlatformInstanceType, readonly string[]>> = {
  telegram: ['TELEGRAM_BOT_TOKEN'],
  mattermost: ['MATTERMOST_URL', 'MATTERMOST_BOT_TOKEN'],
  discord: ['DISCORD_BOT_TOKEN'],
}

const TASK_ENV_REQUIREMENTS: Readonly<Record<TaskInstanceType, readonly string[]>> = {
  kaneo: ['KANEO_CLIENT_URL'],
  youtrack: ['YOUTRACK_URL'],
}

const unreachable = (value: never): never => {
  throw new Error(`Unhandled instance type variant: ${JSON.stringify(value)}`)
}

const getTrimmedEnv = (name: string): string | undefined => {
  const raw = process.env[name]
  if (raw === undefined) return undefined
  const trimmed = raw.trim()
  return trimmed === '' ? undefined : trimmed
}

const parsePlatformType = (value: string | undefined): PlatformInstanceType | null => {
  if (value === 'telegram' || value === 'mattermost' || value === 'discord') return value
  return null
}

const parseTaskType = (value: string | undefined): TaskInstanceType | null => {
  if (value === 'kaneo' || value === 'youtrack') return value
  return null
}

const buildPlatformConfig = (type: PlatformInstanceType): InstanceConfig => {
  switch (type) {
    case 'telegram':
      return { token: getTrimmedEnv('TELEGRAM_BOT_TOKEN') ?? '' }
    case 'mattermost':
      return {
        url: getTrimmedEnv('MATTERMOST_URL') ?? '',
        token: getTrimmedEnv('MATTERMOST_BOT_TOKEN') ?? '',
      }
    case 'discord':
      return { token: getTrimmedEnv('DISCORD_BOT_TOKEN') ?? '' }
    default:
      return unreachable(type)
  }
}

const buildTaskConfig = (type: TaskInstanceType): InstanceConfig => {
  switch (type) {
    case 'kaneo':
      return { url: getTrimmedEnv('KANEO_CLIENT_URL') ?? '' }
    case 'youtrack':
      return { url: getTrimmedEnv('YOUTRACK_URL') ?? '' }
    default:
      return unreachable(type)
  }
}

const countInstances = (): { platforms: number; tasks: number } => {
  const db = getDrizzleDb()
  const p = db.select({ n: count() }).from(platformInstances).get()
  const t = db.select({ n: count() }).from(taskInstances).get()
  return { platforms: p?.n ?? 0, tasks: t?.n ?? 0 }
}

interface ParsedEnv {
  chatType: PlatformInstanceType | null
  taskType: TaskInstanceType | null
  adminUserId: string | undefined
}

const parseEnv = (): ParsedEnv => ({
  chatType: parsePlatformType(getTrimmedEnv('CHAT_PROVIDER')),
  taskType: parseTaskType(getTrimmedEnv('TASK_PROVIDER')),
  adminUserId: getTrimmedEnv('ADMIN_USER_ID'),
})

const collectMissing = (parsed: ParsedEnv): string[] => {
  const missing: string[] = []
  if (parsed.chatType === null) missing.push('CHAT_PROVIDER')
  if (parsed.taskType === null) missing.push('TASK_PROVIDER')
  if (parsed.adminUserId === undefined) missing.push('ADMIN_USER_ID')
  if (parsed.chatType !== null) {
    for (const v of CHAT_ENV_REQUIREMENTS[parsed.chatType]) {
      if (getTrimmedEnv(v) === undefined) missing.push(v)
    }
  }
  if (parsed.taskType !== null) {
    for (const v of TASK_ENV_REQUIREMENTS[parsed.taskType]) {
      if (getTrimmedEnv(v) === undefined) missing.push(v)
    }
  }
  return missing
}

const seedInstances = (
  chatType: PlatformInstanceType,
  taskType: TaskInstanceType,
  adminUserId: string,
): { platformInstanceId: string; taskInstanceId: string } => {
  const platformInstanceId = `${chatType}-default`
  const taskInstanceId = `${taskType}-default`

  insertPlatformInstance({
    id: platformInstanceId,
    type: chatType,
    config: buildPlatformConfig(chatType),
    status: 'active',
  })
  insertTaskInstance({
    id: taskInstanceId,
    type: taskType,
    config: buildTaskConfig(taskType),
    status: 'active',
  })
  addAdmin(adminUserId, SUPER_ADMIN_PLATFORM_ID)
  addAdmin(adminUserId, platformInstanceId)

  return { platformInstanceId, taskInstanceId }
}

export const bootstrapInstancesFromEnv = (): BootstrapResult => {
  const counts = countInstances()
  if (counts.platforms > 0 || counts.tasks > 0) {
    log.info({ counts }, 'Bootstrap skipped: DB already has instance rows')
    return { bootstrapped: false, reason: 'already-bootstrapped' }
  }

  const parsed = parseEnv()
  if (parsed.chatType === null && parsed.taskType === null && parsed.adminUserId === undefined) {
    log.warn('No instances configured. Use the dashboard to add platform and task instances.')
    return { bootstrapped: false, reason: 'no-env' }
  }

  const missing = collectMissing(parsed)
  if (missing.length > 0) {
    log.warn({ missing }, 'Bootstrap aborted: partial environment')
    return { bootstrapped: false, reason: 'partial-env', missing }
  }

  // Narrowing for the type checker: all three are non-null because missing is empty.
  if (parsed.chatType === null || parsed.taskType === null || parsed.adminUserId === undefined) {
    return { bootstrapped: false, reason: 'partial-env', missing }
  }

  const { platformInstanceId, taskInstanceId } = seedInstances(parsed.chatType, parsed.taskType, parsed.adminUserId)

  log.info(
    { platformInstanceId, taskInstanceId, adminUserId: parsed.adminUserId },
    'Bootstrapped from environment variables. DB is now the source of truth.',
  )
  return { bootstrapped: true, platformInstanceId, taskInstanceId }
}
