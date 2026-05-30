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
import type { BootstrapResult, InstanceConfig, PlatformInstanceType } from './types.js'

const log = logger.child({ scope: 'instances:bootstrap' })

const CHAT_ENV_REQUIREMENTS: Readonly<Record<PlatformInstanceType, readonly string[]>> = {
  telegram: ['TELEGRAM_BOT_TOKEN'],
  mattermost: ['MATTERMOST_URL', 'MATTERMOST_BOT_TOKEN'],
  discord: ['DISCORD_BOT_TOKEN'],
  'kontur-talk': ['KONTUR_TALK_JWT_TOKEN'],
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
  if (value === 'telegram' || value === 'mattermost' || value === 'discord' || value === 'kontur-talk') return value
  return null
}

const buildPlatformConfig = (type: PlatformInstanceType): InstanceConfig => {
  switch (type) {
    case 'telegram':
      return { token: getTrimmedEnv('TELEGRAM_BOT_TOKEN') ?? '' }
    case 'mattermost':
      return {
        baseUrl: getTrimmedEnv('MATTERMOST_URL') ?? '',
        token: getTrimmedEnv('MATTERMOST_BOT_TOKEN') ?? '',
      }
    case 'discord':
      return { token: getTrimmedEnv('DISCORD_BOT_TOKEN') ?? '' }
    case 'kontur-talk':
      return { jwtToken: getTrimmedEnv('KONTUR_TALK_JWT_TOKEN') ?? '' }
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
  adminUserId: string | undefined
}

const parseEnv = (): ParsedEnv => ({
  chatType: parsePlatformType(getTrimmedEnv('CHAT_PROVIDER')),
  adminUserId: getTrimmedEnv('ADMIN_USER_ID'),
})

const collectMissing = (parsed: ParsedEnv): string[] => {
  const missing: string[] = []
  if (parsed.chatType === null) missing.push('CHAT_PROVIDER')
  if (parsed.adminUserId === undefined) missing.push('ADMIN_USER_ID')
  if (parsed.chatType !== null) {
    for (const v of CHAT_ENV_REQUIREMENTS[parsed.chatType]) {
      if (getTrimmedEnv(v) === undefined) missing.push(v)
    }
  }
  return missing
}

const seedInstances = (chatType: PlatformInstanceType, adminUserId: string): { platformInstanceId: string } => {
  const platformInstanceId = `${chatType}-default`

  // Spec requirement (docs/superpowers/specs/2026-04-13-multi-provider-phase-1-instance-data-model.md
  // §4 Error Handling): "bootstrap is wrapped in a transaction so partial writes are
  // impossible." The stores all funnel through `getDrizzleDb()`, which shares the
  // underlying `bun:sqlite` Database via `$client`. Wrapping at the SQLite layer
  // means every store write inside the closure lands in the same transaction
  // without refactoring the stores to take a tx-scoped Drizzle handle.
  const sqlite = getDrizzleDb().$client
  const tx = sqlite.transaction(() => {
    insertPlatformInstance({
      id: platformInstanceId,
      type: chatType,
      config: buildPlatformConfig(chatType),
      status: 'active',
    })
    addAdmin(adminUserId, SUPER_ADMIN_PLATFORM_ID)
    addAdmin(adminUserId, platformInstanceId)
  })
  tx()

  return { platformInstanceId }
}

export const bootstrapInstancesFromEnv = (): BootstrapResult => {
  const counts = countInstances()
  if (counts.platforms > 0 || counts.tasks > 0) {
    log.info({ counts }, 'Bootstrap skipped: DB already has instance rows')
    return { bootstrapped: false, reason: 'already-bootstrapped' }
  }

  const parsed = parseEnv()
  if (parsed.chatType === null && parsed.adminUserId === undefined) {
    log.warn('No instances configured. Use the dashboard to add platform and task instances.')
    return { bootstrapped: false, reason: 'no-env' }
  }

  const missing = collectMissing(parsed)
  if (missing.length > 0) {
    log.warn({ missing }, 'Bootstrap aborted: partial environment')
    return { bootstrapped: false, reason: 'partial-env', missing }
  }

  // Narrowing for the type checker: all required values are non-null because missing is empty.
  if (parsed.chatType === null || parsed.adminUserId === undefined) {
    return { bootstrapped: false, reason: 'partial-env', missing }
  }

  const { platformInstanceId } = seedInstances(parsed.chatType, parsed.adminUserId)

  log.info(
    { platformInstanceId, adminUserId: parsed.adminUserId },
    'Bootstrapped from environment variables. DB is now the source of truth.',
  )
  return { bootstrapped: true, platformInstanceId }
}
