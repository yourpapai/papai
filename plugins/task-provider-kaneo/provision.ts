// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { clearCachedToolsByPrefix } from '../../src/cache.js'
import type { ReplyFn } from '../../src/chat/types.js'
import { getConfigValue, setConfigValue } from '../../src/config.js'
import { getContextSettings } from '../../src/instances/context-store.js'
import { getTaskInstance } from '../../src/instances/task-store.js'
import { logger } from '../../src/logger.js'
import { KANEO_PLUGIN_CREDENTIAL_KEY, KANEO_PLUGIN_WORKSPACE_KEY } from '../../src/types/config.js'
import {
  formatKaneoProvisionedMessage,
  formatKaneoProvisionFailureMessage,
  KANEO_REGISTRATION_DISABLED_MESSAGE,
} from './provision-messages.js'
import { provisionKaneoUser } from './provision-requests.js'

const log = logger.child({ scope: 'kaneo:provision' })

export { provisionKaneoUser } from './provision-requests.js'
export type { ProvisionResult } from './provision-requests.js'

type NormalizedProvisionConfig = Readonly<{ publicUrl: string; internalUrl: string | undefined }>

const REGISTRATION_DISABLED_MARKERS = ['signup_disabled', 'registration disabled', 'sign up is disabled'] as const

function getTaskInstancePublicUrl(config: Readonly<Record<string, string>>): string | undefined {
  return config['baseUrl']
}

function getTaskInstanceInternalUrl(config: Readonly<Record<string, string>>): string | undefined {
  return config['internalUrl']
}

function isRegistrationDisabledErrorMessage(message: string): boolean {
  const normalizedMessage = message.toLowerCase()
  return REGISTRATION_DISABLED_MARKERS.some((marker) => normalizedMessage.includes(marker))
}

function clearProvisionedContextToolCaches(contextId: string): void {
  clearCachedToolsByPrefix(contextId)
}

export type ProvisionOutcome =
  | {
      status: 'provisioned'
      email: string
      password: string
      kaneoUrl: string
      apiKey: string
      workspaceId: string
    }
  | { status: 'registration_disabled' }
  | { status: 'failed'; error: string }

export type ProvisionConfig = Readonly<{
  publicUrl: string | undefined
  internalUrl: string | undefined
}>

function normalizeProvisionConfig(config: ProvisionConfig): NormalizedProvisionConfig | null {
  const publicUrl = config.publicUrl
  if (publicUrl === undefined) return null
  const trimmedPublicUrl = publicUrl.trim()
  if (trimmedPublicUrl === '') return null

  const internalUrl = config.internalUrl
  if (internalUrl === undefined) return { publicUrl: trimmedPublicUrl, internalUrl: undefined }
  const trimmedInternalUrl = internalUrl.trim()
  if (trimmedInternalUrl === '') return { publicUrl: trimmedPublicUrl, internalUrl: undefined }
  return { publicUrl: trimmedPublicUrl, internalUrl: trimmedInternalUrl }
}

export async function provisionAndConfigure(
  userId: string,
  username: string | null,
  config: ProvisionConfig,
): Promise<ProvisionOutcome> {
  const normalizedConfig = normalizeProvisionConfig(config)
  if (normalizedConfig === null) return { status: 'failed', error: 'Kaneo task instance public URL is missing' }

  try {
    const kaneoUrl = normalizedConfig.publicUrl
    let kaneoInternalUrl = kaneoUrl
    if (normalizedConfig.internalUrl !== undefined) {
      kaneoInternalUrl = normalizedConfig.internalUrl
    }
    const result = await provisionKaneoUser(kaneoInternalUrl, kaneoUrl, userId, username)
    setConfigValue(userId, KANEO_PLUGIN_CREDENTIAL_KEY, result.kaneoKey)
    setConfigValue(userId, KANEO_PLUGIN_WORKSPACE_KEY, result.workspaceId)
    clearProvisionedContextToolCaches(userId)
    log.info({ userId }, 'Kaneo account provisioned and configured')
    return {
      status: 'provisioned',
      email: result.email,
      password: result.password,
      kaneoUrl,
      apiKey: result.kaneoKey,
      workspaceId: result.workspaceId,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    log.warn({ userId, errorClass: 'provision_failed' }, 'Kaneo provisioning failed')
    if (isRegistrationDisabledErrorMessage(msg)) return { status: 'registration_disabled' }
    return { status: 'failed', error: msg }
  }
}

const provLog = logger.child({ scope: 'kaneo:auto-provision' })

/**
 * Auto-provisions a Kaneo account for a context assigned to an active Kaneo task instance.
 * Unassigned contexts return without provisioning; /config owns task-instance assignment.
 */
export async function maybeProvisionKaneo(
  reply: ReplyFn,
  contextId: string,
  username: string | null,
): Promise<boolean> {
  const settings = getContextSettings(contextId)
  if (settings === null) return false
  const taskInstance = getTaskInstance(settings.taskInstanceId)
  if (taskInstance === null || taskInstance.status !== 'active' || taskInstance.type !== 'kaneo') return false

  if (
    getConfigValue(contextId, KANEO_PLUGIN_WORKSPACE_KEY) !== null &&
    getConfigValue(contextId, KANEO_PLUGIN_CREDENTIAL_KEY) !== null
  ) {
    return false
  }

  const publicUrl = getTaskInstancePublicUrl(taskInstance.config)
  const internalUrl = getTaskInstanceInternalUrl(taskInstance.config)

  provLog.info({ contextId, username }, 'Auto-provisioning Kaneo account')
  const outcome = await provisionAndConfigure(contextId, username, { publicUrl, internalUrl })

  if (outcome.status === 'provisioned') {
    await reply.text(formatKaneoProvisionedMessage(outcome))
    provLog.info({ contextId, workspaceId: outcome.workspaceId }, 'Kaneo account auto-provisioned')
    return true
  }

  if (outcome.status === 'registration_disabled') {
    await reply.text(KANEO_REGISTRATION_DISABLED_MESSAGE)
    provLog.warn({ contextId }, 'Kaneo auto-provisioning failed: registration disabled')
    return true
  }

  await reply.text(formatKaneoProvisionFailureMessage(outcome.error))
  provLog.error({ contextId, errorClass: 'auto_provision_failed' }, 'Kaneo auto-provisioning failed')
  return true
}
