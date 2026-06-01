// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { inArray } from 'drizzle-orm'

import { parseScopedContextId } from '../chat/scoped-context.js'
import { getDrizzleDb } from '../db/drizzle.js'
import { taskInstances, userConfig } from '../db/schema.js'
import { logger } from '../logger.js'
import { setPluginEnabledForContext } from '../plugins/registry.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY } from '../types/config.js'
import { getContextSettings, setContextSettings } from './context-store.js'
import { insertTaskInstance, listTaskInstancesSafe, updateTaskInstance } from './task-store.js'

const log = logger.child({ scope: 'instances:kaneo-legacy-repair' })

const KANEO_PLUGIN_ID = 'task-provider-kaneo'
const KANEO_DEFAULT_INSTANCE_ID = 'kaneo-default'
const LEGACY_KANEO_CONFIG_KEYS = [KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY] as const

type RepairSummary = {
  repairedContexts: number
  createdTaskInstances: number
  promotedTaskInstances: number
  skippedDueToAmbiguousTaskInstance: number
}

const emptyRepairSummary = (): RepairSummary => ({
  repairedContexts: 0,
  createdTaskInstances: 0,
  promotedTaskInstances: 0,
  skippedDueToAmbiguousTaskInstance: 0,
})

function listLegacyConfiguredContextIds(): string[] {
  const rows = getDrizzleDb()
    .select({ contextId: userConfig.userId, key: userConfig.key })
    .from(userConfig)
    .where(inArray(userConfig.key, LEGACY_KANEO_CONFIG_KEYS))
    .all()

  const keysByContextId = new Map<string, Set<string>>()
  for (const row of rows) {
    const keys = keysByContextId.get(row.contextId) ?? new Set<string>()
    keys.add(row.key)
    keysByContextId.set(row.contextId, keys)
  }

  return [...keysByContextId.entries()]
    .filter(([, keys]) => keys.has(KANEO_PLUGIN_CREDENTIAL_KEY) && keys.has(KANEO_PLUGIN_WORKSPACE_KEY))
    .map(([contextId]) => contextId)
}

function resolveUsableKaneoTaskInstance(): { id: string; created: boolean; promoted: boolean } | null {
  const taskInstanceResult = listTaskInstancesSafe()
  for (const failure of taskInstanceResult.failures) {
    log.warn(failure, 'Skipping unreadable task instance during Kaneo legacy repair')
  }
  const kaneoInstances = taskInstanceResult.instances.filter((instance) => instance.type === 'kaneo')
  const activeInstances = kaneoInstances.filter((instance) => instance.status === 'active')
  if (activeInstances.length === 1) {
    return { id: activeInstances[0]!.id, created: false, promoted: false }
  }
  if (activeInstances.length > 1) return null

  const pendingInstances = kaneoInstances.filter((instance) => instance.status === 'pending')
  if (pendingInstances.length === 1) {
    if (isValidKaneoPendingConfig(pendingInstances[0]!.config)) {
      updateTaskInstance(pendingInstances[0]!.id, { config: undefined, status: 'active' })
      return { id: pendingInstances[0]!.id, created: false, promoted: true }
    }
  }
  if (pendingInstances.length > 1) return null

  const baseUrl = process.env['KANEO_CLIENT_URL']?.trim()
  if (baseUrl === undefined || baseUrl === '') return null

  const internalUrl = process.env['KANEO_INTERNAL_URL']?.trim()
  const taskInstanceId = getUnusedDefaultKaneoTaskInstanceId()
  insertTaskInstance({
    id: taskInstanceId,
    type: 'kaneo',
    status: 'active',
    config: internalUrl !== undefined && internalUrl !== '' ? { baseUrl, internalUrl } : { baseUrl },
  })
  return { id: taskInstanceId, created: true, promoted: false }
}

function isValidKaneoPendingConfig(config: Record<string, string>): boolean {
  const baseUrl = config['baseUrl']?.trim()
  if (baseUrl === undefined || baseUrl === '' || !isHttpUrl(baseUrl)) return false

  const internalUrl = config['internalUrl']?.trim()
  if (internalUrl === undefined || internalUrl === '') return true
  return isHttpUrl(internalUrl)
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function getUnusedDefaultKaneoTaskInstanceId(): string {
  const takenIds = new Set(
    getDrizzleDb()
      .select({ id: taskInstances.id })
      .from(taskInstances)
      .all()
      .map((row) => row.id),
  )
  if (!takenIds.has(KANEO_DEFAULT_INSTANCE_ID)) return KANEO_DEFAULT_INSTANCE_ID

  let suffix = 2
  while (takenIds.has(`${KANEO_DEFAULT_INSTANCE_ID}-${suffix}`)) {
    suffix += 1
  }
  return `${KANEO_DEFAULT_INSTANCE_ID}-${suffix}`
}

function splitLegacyContexts(candidateContextIds: readonly string[]): {
  readonly existingContextIds: string[]
  readonly contextIdsNeedingBackfill: string[]
} {
  const existingContextIds: string[] = []
  const contextIdsNeedingBackfill: string[] = []

  for (const contextId of candidateContextIds) {
    if (getContextSettings(contextId) !== null) {
      existingContextIds.push(contextId)
      continue
    }
    contextIdsNeedingBackfill.push(contextId)
  }

  return { existingContextIds, contextIdsNeedingBackfill }
}

function enableKaneoPluginForContexts(contextIds: readonly string[]): void {
  for (const contextId of contextIds) {
    setPluginEnabledForContext(KANEO_PLUGIN_ID, contextId, true)
  }
}

function backfillKaneoContextAssignments(contextIds: readonly string[], taskInstanceId: string): number {
  let repairedContexts = 0

  for (const contextId of contextIds) {
    const parsedContext = parseScopedContextId(contextId)
    if (parsedContext === null) continue

    setContextSettings({
      contextId,
      taskInstanceId,
      platformInstanceId: parsedContext.platformInstanceId,
    })
    repairedContexts += 1
  }

  return repairedContexts
}

export function runKaneoLegacyRepair(): RepairSummary {
  const candidateContextIds = listLegacyConfiguredContextIds()
  if (candidateContextIds.length === 0) return emptyRepairSummary()

  const { existingContextIds, contextIdsNeedingBackfill } = splitLegacyContexts(candidateContextIds)
  enableKaneoPluginForContexts(existingContextIds)

  if (contextIdsNeedingBackfill.length === 0) return emptyRepairSummary()

  const taskInstance = resolveUsableKaneoTaskInstance()
  if (taskInstance === null) {
    log.warn(
      { candidateContextCount: candidateContextIds.length, backfillContextCount: contextIdsNeedingBackfill.length },
      'Skipping Kaneo legacy repair because no unambiguous Kaneo task instance is available',
    )
    return {
      repairedContexts: 0,
      createdTaskInstances: 0,
      promotedTaskInstances: 0,
      skippedDueToAmbiguousTaskInstance: contextIdsNeedingBackfill.length,
    }
  }

  enableKaneoPluginForContexts(contextIdsNeedingBackfill)
  const repairedContexts = backfillKaneoContextAssignments(contextIdsNeedingBackfill, taskInstance.id)

  return {
    repairedContexts,
    createdTaskInstances: taskInstance.created ? 1 : 0,
    promotedTaskInstances: taskInstance.promoted ? 1 : 0,
    skippedDueToAmbiguousTaskInstance: 0,
  }
}
