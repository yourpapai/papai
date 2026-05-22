// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { getConfig } from '../config.js'
import { logger } from '../logger.js'
import { getKaneoWorkspace } from '../users.js'
import { isKaneoSessionCookie } from './kaneo/client.js'
import { createProvider } from './registry.js'
import type { TaskProvider } from './types.js'

const log = logger.child({ scope: 'provider:factory' })

const getTaskProvider = (): string => {
  const taskProvider = process.env['TASK_PROVIDER']
  if (taskProvider === undefined || taskProvider === '') {
    return 'kaneo'
  }
  return taskProvider
}

const TASK_PROVIDER = getTaskProvider()

const buildKaneoProvider = (userId: string, strict: boolean): TaskProvider | null => {
  const kaneoKey = getConfig(userId, 'kaneo_apikey')
  const kaneoBaseUrl = process.env['KANEO_CLIENT_URL']
  const workspaceId = getKaneoWorkspace(userId)

  if (kaneoKey === null || kaneoBaseUrl === undefined || kaneoBaseUrl === '' || workspaceId === null) {
    const missing = [
      kaneoKey === null ? 'kaneo_apikey' : null,
      kaneoBaseUrl === undefined || kaneoBaseUrl === '' ? 'KANEO_CLIENT_URL' : null,
      workspaceId === null ? 'workspaceId' : null,
    ].filter((v): v is string => v !== null)

    const reason = `Missing required configuration: ${missing.join(', ')}`
    log.warn({ userId, missing }, 'Cannot build provider: missing config')

    if (strict) throw new Error(reason)
    return null
  }

  const isSessionCookie = isKaneoSessionCookie(kaneoKey)
  const config: Record<string, string> = isSessionCookie
    ? { baseUrl: kaneoBaseUrl, sessionCookie: kaneoKey, workspaceId }
    : { apiKey: kaneoKey, baseUrl: kaneoBaseUrl, workspaceId }

  log.info({ userId, workspaceId }, 'Kaneo provider built')
  return createProvider('kaneo', config)
}

const buildYouTrackProvider = (userId: string, strict: boolean): TaskProvider | null => {
  const baseUrl = process.env['YOUTRACK_URL']
  const token = getConfig(userId, 'youtrack_token')

  if (baseUrl === undefined || baseUrl === '' || token === null) {
    const missing = [
      baseUrl === undefined || baseUrl === '' ? 'YOUTRACK_URL' : null,
      token === null ? 'youtrack_token' : null,
    ].filter((v): v is string => v !== null)

    const reason = `Missing required configuration: ${missing.join(', ')}`
    log.warn({ userId, missing }, 'Cannot build provider: missing config')

    if (strict) throw new Error(reason)
    return null
  }

  log.info({ userId }, 'YouTrack provider built')
  return createProvider('youtrack', { baseUrl, token })
}

/**
 * Build a task provider for a user with configurable error handling.
 *
 * @param userId - The user ID to build the provider for
 * @param strict - If true, throws on missing config; if false, returns null
 * @returns TaskProvider instance, or null if strict=false and config is missing
 * @throws Error if strict=true and required config is missing
 */
export function buildProviderForUser(userId: string, strict: false): TaskProvider | null
export function buildProviderForUser(userId: string, strict: true): TaskProvider
export function buildProviderForUser(userId: string, strict: boolean): TaskProvider | null {
  log.debug({ userId, strict, providerName: TASK_PROVIDER }, 'Building provider')

  if (TASK_PROVIDER === 'kaneo') return buildKaneoProvider(userId, strict)
  if (TASK_PROVIDER === 'youtrack') return buildYouTrackProvider(userId, strict)

  const reason = `Unknown provider: ${TASK_PROVIDER}`
  log.error({ providerName: TASK_PROVIDER }, reason)

  if (strict) throw new Error(reason)
  return null
}
