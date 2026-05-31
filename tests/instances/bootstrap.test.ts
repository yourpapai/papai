// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { sql } from 'drizzle-orm'

import { getDrizzleDb } from '../../src/db/drizzle.js'
import { isAdmin, SUPER_ADMIN_PLATFORM_ID } from '../../src/instances/admin-store.js'
import { bootstrapInstancesFromEnv } from '../../src/instances/bootstrap.js'
import { listPlatformInstances } from '../../src/instances/platform-store.js'
import { listTaskInstances } from '../../src/instances/task-store.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

const ENV_KEYS = [
  'CHAT_PROVIDER',
  'TASK_PROVIDER',
  'ADMIN_USER_ID',
  'TELEGRAM_BOT_TOKEN',
  'MATTERMOST_URL',
  'MATTERMOST_BOT_TOKEN',
  'DISCORD_BOT_TOKEN',
  'KANEO_CLIENT_URL',
  'YOUTRACK_URL',
  'INSTANCE_CONFIG_KEY',
]

const snapshotEnv = (): Map<string, string | undefined> => {
  const snap = new Map<string, string | undefined>()
  for (const k of ENV_KEYS) snap.set(k, process.env[k])
  return snap
}

const restoreEnv = (snap: Map<string, string | undefined>): void => {
  for (const [k, v] of snap) {
    if (v === undefined) Reflect.deleteProperty(process.env, k)
    else process.env[k] = v
  }
}

describe('bootstrapInstancesFromEnv', () => {
  let envSnap: Map<string, string | undefined>

  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    envSnap = snapshotEnv()
    for (const k of ENV_KEYS) Reflect.deleteProperty(process.env, k)
    process.env['INSTANCE_CONFIG_KEY'] = '3'.repeat(64)
  })

  afterEach(() => {
    restoreEnv(envSnap)
  })

  test('bootstrap does not read TASK_PROVIDER or task env vars', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg'
    process.env['ADMIN_USER_ID'] = '1'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    const result = bootstrapInstancesFromEnv()

    expect(result).toMatchObject({ bootstrapped: true, platformInstanceId: 'telegram-default' })
    expect(result).not.toHaveProperty('taskInstanceId')
    expect(listTaskInstances()).toHaveLength(0)
  })

  test('bootstrap accepts a deployment with no task env vars set', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg'
    process.env['ADMIN_USER_ID'] = '1'

    expect(bootstrapInstancesFromEnv().bootstrapped).toBe(true)
  })

  test('empty DB + complete telegram env seeds platform and admin rows', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: true,
      platformInstanceId: 'telegram-default',
    })

    const platforms = listPlatformInstances()
    expect(platforms).toHaveLength(1)
    expect(platforms[0]?.type).toBe('telegram')
    expect(platforms[0]?.status).toBe('active')
    expect(platforms[0]?.config['token']).toBe('tg-token')

    expect(listTaskInstances()).toHaveLength(0)

    expect(isAdmin('admin-1', SUPER_ADMIN_PLATFORM_ID)).toBe(true)
    expect(isAdmin('admin-1', 'telegram-default')).toBe(true)
  })

  test('mattermost requires both url and token', () => {
    process.env['CHAT_PROVIDER'] = 'mattermost'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['MATTERMOST_URL'] = 'https://mm.invalid'
    // MATTERMOST_BOT_TOKEN intentionally missing

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: false,
      reason: 'partial-env',
      missing: ['MATTERMOST_BOT_TOKEN'],
    })
    expect(listPlatformInstances()).toHaveLength(0)
    expect(listTaskInstances()).toHaveLength(0)
  })

  test('empty DB + no env returns no-env (does not throw)', () => {
    const result = bootstrapInstancesFromEnv()
    expect(result).toEqual({ bootstrapped: false, reason: 'no-env' })
    expect(listPlatformInstances()).toHaveLength(0)
  })

  test('rerunning with the same env is idempotent (already-bootstrapped)', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'

    bootstrapInstancesFromEnv()
    const second = bootstrapInstancesFromEnv()

    expect(second).toEqual({ bootstrapped: false, reason: 'already-bootstrapped' })
    expect(listPlatformInstances()).toHaveLength(1)
    expect(listTaskInstances()).toHaveLength(0)
  })

  test('seeds discord platform when CHAT_PROVIDER=discord', () => {
    process.env['CHAT_PROVIDER'] = 'discord'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['DISCORD_BOT_TOKEN'] = 'dc-token'

    const result = bootstrapInstancesFromEnv()
    expect(result).toEqual({
      bootstrapped: true,
      platformInstanceId: 'discord-default',
    })
    expect(listPlatformInstances()[0]?.config['token']).toBe('dc-token')
    expect(listTaskInstances()).toHaveLength(0)
  })

  test('empty DB + complete mattermost env writes descriptor-shaped baseUrl config', () => {
    process.env['CHAT_PROVIDER'] = 'mattermost'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['MATTERMOST_URL'] = 'https://mattermost.invalid'
    process.env['MATTERMOST_BOT_TOKEN'] = 'mm-token'

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: true,
      platformInstanceId: 'mattermost-default',
    })

    expect(listPlatformInstances()[0]?.config).toMatchObject({ baseUrl: 'https://mattermost.invalid' })
    expect(listPlatformInstances()[0]?.config).not.toHaveProperty('url')
    expect(listTaskInstances()).toHaveLength(0)
  })

  test('bootstrap is atomic: a failure mid-seed leaves the DB clean', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'

    // Force the platform insert to fail by dropping the table out from under it.
    // The bootstrap should propagate the error AND roll back any rows inserted
    // before the failure so the DB stays clean.
    const db = getDrizzleDb()
    db.run(sql`DROP TABLE platform_instances`)

    expect(() => bootstrapInstancesFromEnv()).toThrow()

    // Re-create the table so the post-throw assertion can query it cleanly.
    db.run(sql`
      CREATE TABLE platform_instances (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        config TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `)

    expect(listPlatformInstances()).toHaveLength(0)
    expect(listTaskInstances()).toHaveLength(0)
    expect(isAdmin('admin-1', SUPER_ADMIN_PLATFORM_ID)).toBe(false)
    expect(isAdmin('admin-1', 'telegram-default')).toBe(false)
  })
})
