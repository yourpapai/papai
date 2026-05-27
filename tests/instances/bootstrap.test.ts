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

  test('empty DB + complete telegram + kaneo env → seeds defaults', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: true,
      platformInstanceId: 'telegram-default',
      taskInstanceId: 'kaneo-default',
    })

    const platforms = listPlatformInstances()
    expect(platforms).toHaveLength(1)
    expect(platforms[0]?.type).toBe('telegram')
    expect(platforms[0]?.status).toBe('active')
    expect(platforms[0]?.config['token']).toBe('tg-token')

    const tasks = listTaskInstances()
    expect(tasks).toHaveLength(1)
    expect(tasks[0]?.type).toBe('kaneo')
    expect(tasks[0]?.config).toMatchObject({ baseUrl: 'https://kaneo.invalid' })
    expect(tasks[0]?.config).not.toHaveProperty('url')

    expect(isAdmin('admin-1', SUPER_ADMIN_PLATFORM_ID)).toBe(true)
    expect(isAdmin('admin-1', 'telegram-default')).toBe(true)
  })

  test('mattermost requires both url and token', () => {
    process.env['CHAT_PROVIDER'] = 'mattermost'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['MATTERMOST_URL'] = 'https://mm.invalid'
    // MATTERMOST_BOT_TOKEN intentionally missing
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: false,
      reason: 'partial-env',
      missing: ['MATTERMOST_BOT_TOKEN'],
    })
    expect(listPlatformInstances()).toHaveLength(0)
    expect(listTaskInstances()).toHaveLength(0)
  })

  test('youtrack requires YOUTRACK_URL', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TASK_PROVIDER'] = 'youtrack'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'
    // YOUTRACK_URL missing

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: false,
      reason: 'partial-env',
      missing: ['YOUTRACK_URL'],
    })
  })

  test('empty DB + no env returns no-env (does not throw)', () => {
    const result = bootstrapInstancesFromEnv()
    expect(result).toEqual({ bootstrapped: false, reason: 'no-env' })
    expect(listPlatformInstances()).toHaveLength(0)
  })

  test('rerunning with the same env is idempotent (already-bootstrapped)', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    bootstrapInstancesFromEnv()
    const second = bootstrapInstancesFromEnv()

    expect(second).toEqual({ bootstrapped: false, reason: 'already-bootstrapped' })
    expect(listPlatformInstances()).toHaveLength(1)
    expect(listTaskInstances()).toHaveLength(1)
  })

  test('seeds discord platform when CHAT_PROVIDER=discord', () => {
    process.env['CHAT_PROVIDER'] = 'discord'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['DISCORD_BOT_TOKEN'] = 'dc-token'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    const result = bootstrapInstancesFromEnv()
    expect(result).toEqual({
      bootstrapped: true,
      platformInstanceId: 'discord-default',
      taskInstanceId: 'kaneo-default',
    })
    expect(listPlatformInstances()[0]?.config['token']).toBe('dc-token')
  })

  test('empty DB + complete mattermost + youtrack env writes descriptor-shaped baseUrl configs', () => {
    process.env['CHAT_PROVIDER'] = 'mattermost'
    process.env['TASK_PROVIDER'] = 'youtrack'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['MATTERMOST_URL'] = 'https://mattermost.invalid'
    process.env['MATTERMOST_BOT_TOKEN'] = 'mm-token'
    process.env['YOUTRACK_URL'] = 'https://youtrack.invalid'

    const result = bootstrapInstancesFromEnv()

    expect(result).toEqual({
      bootstrapped: true,
      platformInstanceId: 'mattermost-default',
      taskInstanceId: 'youtrack-default',
    })

    expect(listPlatformInstances()[0]?.config).toMatchObject({ baseUrl: 'https://mattermost.invalid' })
    expect(listPlatformInstances()[0]?.config).not.toHaveProperty('url')
    expect(listTaskInstances()[0]?.config).toMatchObject({ baseUrl: 'https://youtrack.invalid' })
    expect(listTaskInstances()[0]?.config).not.toHaveProperty('url')
  })

  test('bootstrap is atomic: a failure mid-seed leaves the DB clean', () => {
    process.env['CHAT_PROVIDER'] = 'telegram'
    process.env['TASK_PROVIDER'] = 'kaneo'
    process.env['ADMIN_USER_ID'] = 'admin-1'
    process.env['TELEGRAM_BOT_TOKEN'] = 'tg-token'
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.invalid'

    // Force the second store write (`insertTaskInstance`) to fail by dropping
    // the table out from under it. The bootstrap should propagate the error
    // AND roll back the platform-instance row that was inserted first.
    const db = getDrizzleDb()
    db.run(sql`DROP TABLE task_instances`)

    expect(() => bootstrapInstancesFromEnv()).toThrow()

    // Re-create `task_instances` so the post-throw assertion can read both
    // tables without tripping over the missing one. If the seed had been
    // non-transactional, the platform row from write #1 would still be
    // present here.
    db.run(sql`
      CREATE TABLE task_instances (
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
