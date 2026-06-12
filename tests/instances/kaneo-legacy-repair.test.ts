// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { count, eq } from 'drizzle-orm'

import { toScopedContextId } from '../../src/chat/scoped-context.js'
import { getDrizzleDb } from '../../src/db/drizzle.js'
import { migration051LegacyContextIdBackfill } from '../../src/db/migrations/051_legacy_context_id_backfill.js'
import { taskInstances, userConfig } from '../../src/db/schema.js'
import { getContextSettings, setContextSettings } from '../../src/instances/context-store.js'
import { runKaneoLegacyRepair } from '../../src/instances/kaneo-legacy-repair.js'
import { getTaskInstance, insertTaskInstance, listTaskInstances } from '../../src/instances/task-store.js'
import { getPluginContextState } from '../../src/plugins/store.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY } from '../../src/types/config.js'
import { addUser } from '../../src/users.js'
import { mockLogger, seedTestPlatformInstance, seedTestTaskInstance, setupTestDb } from '../utils/test-helpers.js'

function seedLegacyKaneoConfig(contextId: string): void {
  getDrizzleDb()
    .insert(userConfig)
    .values([
      { userId: contextId, key: KANEO_PLUGIN_CREDENTIAL_KEY, value: 'cred-1' },
      { userId: contextId, key: KANEO_PLUGIN_WORKSPACE_KEY, value: 'ws-1' },
    ])
    .run()
}

describe('runKaneoLegacyRepair', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
    process.env['INSTANCE_CONFIG_KEY'] = '7'.repeat(64)
    seedTestPlatformInstance({ id: 'pi-1' })
    addUser({ userId: 'u-1', platformInstanceId: 'pi-1', addedBy: 'boot', username: undefined })
  })

  afterEach(() => {
    delete process.env['INSTANCE_CONFIG_KEY']
    delete process.env['KANEO_CLIENT_URL']
    delete process.env['KANEO_INTERNAL_URL']
  })

  test('creates one active Kaneo task instance and backfills assignment + plugin enablement', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example'
    process.env['KANEO_INTERNAL_URL'] = 'https://kaneo.internal'

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 1,
      createdTaskInstances: 1,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 0,
    })
    expect(listTaskInstances().map((row) => ({ id: row.id, type: row.type, status: row.status }))).toEqual([
      { id: 'kaneo-default', type: 'kaneo', status: 'active' },
    ])
    expect(getContextSettings(contextId)?.taskInstanceId).toBe('kaneo-default')
    expect(getPluginContextState('task-provider-kaneo', contextId)?.enabled).toBe(true)
  })

  test('skips unreadable task instance rows and still repairs from readable state', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example'
    getDrizzleDb()
      .insert(taskInstances)
      .values({ id: 'bad-row', type: 'kaneo', config: 'not-base64', status: 'stopped' })
      .run()

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 1,
      createdTaskInstances: 1,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 0,
    })
    expect(getContextSettings(contextId)?.taskInstanceId).toBe('kaneo-default')
    expect(getPluginContextState('task-provider-kaneo', contextId)?.enabled).toBe(true)
  })

  test('promotes a single pending Kaneo instance instead of creating a second row', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    insertTaskInstance({
      id: 'legacy-kaneo',
      type: 'kaneo',
      status: 'pending',
      config: { baseUrl: 'https://kaneo.example', internalUrl: 'https://kaneo.internal' },
    })

    const summary = runKaneoLegacyRepair()

    expect(summary.promotedTaskInstances).toBe(1)
    expect(summary.createdTaskInstances).toBe(0)
    expect(getTaskInstance('legacy-kaneo')?.status).toBe('active')
    expect(listTaskInstances()).toHaveLength(1)
    expect(getContextSettings(contextId)?.taskInstanceId).toBe('legacy-kaneo')
    expect(getPluginContextState('task-provider-kaneo', contextId)?.enabled).toBe(true)
  })

  test('does not promote or use a single pending Kaneo instance when its stored config is invalid', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example'
    insertTaskInstance({
      id: 'legacy-kaneo-invalid',
      type: 'kaneo',
      status: 'pending',
      config: {},
    })

    const summary = runKaneoLegacyRepair()

    expect(summary.promotedTaskInstances).toBe(0)
    expect(summary.createdTaskInstances).toBe(1)
    expect(getContextSettings(contextId)?.taskInstanceId).toBe('kaneo-default')
    expect(getTaskInstance('legacy-kaneo-invalid')?.status).toBe('pending')
  })

  test('reuses exactly one active Kaneo task instance', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    insertTaskInstance({
      id: 'active-kaneo',
      type: 'kaneo',
      status: 'active',
      config: { baseUrl: 'https://one.example' },
    })

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 1,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 0,
    })
    expect(listTaskInstances().map((instance) => instance.id)).toEqual(['active-kaneo'])
    expect(getContextSettings(contextId)?.taskInstanceId).toBe('active-kaneo')
  })

  test('does not overwrite an existing context settings assignment', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    insertTaskInstance({
      id: 'existing-task',
      type: 'youtrack',
      status: 'active',
      config: { baseUrl: 'https://yt.example' },
    })
    insertTaskInstance({
      id: 'active-kaneo',
      type: 'kaneo',
      status: 'active',
      config: { baseUrl: 'https://one.example' },
    })
    setContextSettings({
      contextId,
      taskInstanceId: 'existing-task',
      platformInstanceId: 'pi-1',
    })

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 0,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 0,
    })
    expect(getContextSettings(contextId)).toEqual({
      contextId,
      taskInstanceId: 'existing-task',
      platformInstanceId: 'pi-1',
    })
    expect(getPluginContextState('task-provider-kaneo', contextId)?.enabled).toBe(true)
  })

  test('skips assignment when multiple active Kaneo instances already exist', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    insertTaskInstance({ id: 'k1', type: 'kaneo', status: 'active', config: { baseUrl: 'https://one.example' } })
    insertTaskInstance({ id: 'k2', type: 'kaneo', status: 'active', config: { baseUrl: 'https://two.example' } })

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 0,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 1,
    })
    expect(getContextSettings(contextId)).toBeNull()
    expect(getPluginContextState('task-provider-kaneo', contextId)).toBeUndefined()
  })

  test('still enables plugin for already-assigned legacy contexts when ambiguous Kaneo instances block only backfill', () => {
    const assignedContextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    const unassignedContextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-2' })
    seedLegacyKaneoConfig(assignedContextId)
    seedLegacyKaneoConfig(unassignedContextId)
    insertTaskInstance({
      id: 'existing-task',
      type: 'youtrack',
      status: 'active',
      config: { baseUrl: 'https://yt.example' },
    })
    setContextSettings({
      contextId: assignedContextId,
      taskInstanceId: 'existing-task',
      platformInstanceId: 'pi-1',
    })
    insertTaskInstance({ id: 'k1', type: 'kaneo', status: 'active', config: { baseUrl: 'https://one.example' } })
    insertTaskInstance({ id: 'k2', type: 'kaneo', status: 'active', config: { baseUrl: 'https://two.example' } })

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 0,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 1,
    })
    expect(getContextSettings(assignedContextId)).toEqual({
      contextId: assignedContextId,
      taskInstanceId: 'existing-task',
      platformInstanceId: 'pi-1',
    })
    expect(getPluginContextState('task-provider-kaneo', assignedContextId)?.enabled).toBe(true)
    expect(getContextSettings(unassignedContextId)).toBeNull()
  })

  test('skips assignment when multiple pending Kaneo instances already exist', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    insertTaskInstance({ id: 'k1', type: 'kaneo', status: 'pending', config: { baseUrl: 'https://one.example' } })
    insertTaskInstance({ id: 'k2', type: 'kaneo', status: 'pending', config: { baseUrl: 'https://two.example' } })

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 0,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 1,
    })
    expect(getTaskInstance('k1')?.status).toBe('pending')
    expect(getTaskInstance('k2')?.status).toBe('pending')
    expect(getContextSettings(contextId)).toBeNull()
  })

  test('creates a default active instance when only stopped Kaneo instances exist', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example'
    process.env['KANEO_INTERNAL_URL'] = 'https://kaneo.internal'
    insertTaskInstance({
      id: 'k-stopped',
      type: 'kaneo',
      status: 'stopped',
      config: { baseUrl: 'https://one.example' },
    })

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 1,
      createdTaskInstances: 1,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 0,
    })
    expect(listTaskInstances().map((instance) => ({ id: instance.id, status: instance.status }))).toEqual([
      { id: 'k-stopped', status: 'stopped' },
      { id: 'kaneo-default', status: 'active' },
    ])
    expect(getContextSettings(contextId)?.taskInstanceId).toBe('kaneo-default')
    expect(getPluginContextState('task-provider-kaneo', contextId)?.enabled).toBe(true)
  })

  test('creates a collision-safe default Kaneo instance id when kaneo-default is already occupied', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example'
    insertTaskInstance({
      id: 'kaneo-default',
      type: 'youtrack',
      status: 'stopped',
      config: { baseUrl: 'https://yt.example' },
    })

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 1,
      createdTaskInstances: 1,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 0,
    })
    expect(
      listTaskInstances()
        .map((instance) => instance.id)
        .toSorted(),
    ).toEqual(['kaneo-default', 'kaneo-default-2'])
    expect(getContextSettings(contextId)?.taskInstanceId).toBe('kaneo-default-2')
  })

  test('is idempotent on repeated startup runs', () => {
    const contextId = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: 'u-1' })
    seedLegacyKaneoConfig(contextId)
    process.env['KANEO_CLIENT_URL'] = 'https://kaneo.example'

    const firstSummary = runKaneoLegacyRepair()
    const secondSummary = runKaneoLegacyRepair()

    expect(firstSummary.createdTaskInstances).toBe(1)
    expect(secondSummary).toEqual({
      repairedContexts: 0,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 0,
    })
    expect(listTaskInstances().map((instance) => instance.id)).toEqual(['kaneo-default'])
    expect(getContextSettings(contextId)).toEqual({
      contextId,
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'pi-1',
    })
  })

  test('production-shape DB: raw user_config ids get scoped by migration 051 and then repaired', () => {
    seedTestTaskInstance({ id: 'kaneo-default' })
    const rawUserId = '-1003555943365'
    const rawTimezone = 'Etc/GMT-5'
    const rawCredential = 'kaneo-cred'
    const rawWorkspace = 'kaneo-ws'
    getDrizzleDb()
      .insert(userConfig)
      .values([
        { userId: rawUserId, key: KANEO_PLUGIN_CREDENTIAL_KEY, value: rawCredential },
        { userId: rawUserId, key: KANEO_PLUGIN_WORKSPACE_KEY, value: rawWorkspace },
        { userId: rawUserId, key: 'timezone', value: rawTimezone },
      ])
      .run()

    migration051LegacyContextIdBackfill.up(getDrizzleDb().$client)

    const scopedUser = toScopedContextId({ platformInstanceId: 'pi-1', nativeContextId: rawUserId })
    const userConfigAfterMigration = getDrizzleDb()
      .select({ key: userConfig.key, value: userConfig.value })
      .from(userConfig)
      .where(eq(userConfig.userId, scopedUser))
      .all()
    expect(userConfigAfterMigration).toEqual([
      { key: KANEO_PLUGIN_CREDENTIAL_KEY, value: rawCredential },
      { key: KANEO_PLUGIN_WORKSPACE_KEY, value: rawWorkspace },
      { key: 'timezone', value: rawTimezone },
    ])
    expect(
      getDrizzleDb().select({ count: count() }).from(userConfig).where(eq(userConfig.userId, rawUserId)).get(),
    ).toEqual({ count: 0 })
    expect(getContextSettings(scopedUser)).toBeNull()

    const summary = runKaneoLegacyRepair()

    expect(summary).toEqual({
      repairedContexts: 1,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: 0,
    })
    expect(getContextSettings(scopedUser)).toEqual({
      contextId: scopedUser,
      taskInstanceId: 'kaneo-default',
      platformInstanceId: 'pi-1',
    })
    expect(getPluginContextState('task-provider-kaneo', scopedUser)?.enabled).toBe(true)
    expect(getTaskInstance('kaneo-default')?.status).toBe('active')
  })
})
