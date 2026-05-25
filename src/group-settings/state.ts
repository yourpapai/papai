// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { GroupSettingsCommand, GroupSettingsSession, GroupSettingsSessionStage } from './types.js'

const log = logger.child({ scope: 'group-settings:state' })
const GROUP_SETTINGS_SESSION_TTL_MS = 30 * 60 * 1000
const activeSessions = new Map<string, GroupSettingsSession>()

type CreateGroupSettingsSessionParams = Readonly<
  {
    userId: string
    command: GroupSettingsCommand
    stage: GroupSettingsSessionStage
  } & Partial<Record<'platformInstanceId' | 'targetContextId', string>>
>

type GroupSettingsSessionUpdate = Readonly<Partial<Record<'stage', GroupSettingsSessionStage> & Record<'targetContextId', string>>>

const isExpired = (session: GroupSettingsSession): boolean =>
  Date.now() - session.startedAt.getTime() > GROUP_SETTINGS_SESSION_TTL_MS

const getSessionKey = (userId: string, platformInstanceId: string | undefined): string =>
  platformInstanceId === undefined ? userId : `${platformInstanceId}:${userId}`

const getSessionEntry = (
  userId: string,
  platformInstanceId: string | undefined,
): { key: string; session: GroupSettingsSession } | null => {
  const sessionKey = getSessionKey(userId, platformInstanceId)
  const session = activeSessions.get(sessionKey)
  if (session !== undefined) return { key: sessionKey, session }
  if (platformInstanceId === undefined) return null

  const legacySession = activeSessions.get(userId)
  return legacySession === undefined ? null : { key: userId, session: legacySession }
}

export function createGroupSettingsSession(params: CreateGroupSettingsSessionParams): GroupSettingsSession {
  log.debug(
    { userId: params.userId, command: params.command, stage: params.stage },
    'createGroupSettingsSession called',
  )

  const session: GroupSettingsSession = {
    userId: params.userId,
    platformInstanceId: params.platformInstanceId,
    command: params.command,
    stage: params.stage,
    startedAt: new Date(),
    targetContextId: params.targetContextId,
  }

  activeSessions.set(getSessionKey(params.userId, params.platformInstanceId), session)
  log.info({ userId: params.userId, command: params.command, stage: params.stage }, 'Created group settings session')
  return session
}

const getGroupSettingsSessionForScope = (
  userId: string,
  platformInstanceId: string | undefined,
): GroupSettingsSession | null => {
  log.debug({ userId, platformInstanceId }, 'getGroupSettingsSession called')

  const entry = getSessionEntry(userId, platformInstanceId)
  if (entry === null) {
    return null
  }
  if (isExpired(entry.session)) {
    activeSessions.delete(entry.key)
    log.info({ userId }, 'Expired group settings session')
    return null
  }
  return entry.session
}

export function getGroupSettingsSession(userId: string, ...scope: [] | [platformInstanceId: string]): GroupSettingsSession | null {
  return getGroupSettingsSessionForScope(userId, scope.length === 0 ? undefined : scope[0])
}

export function updateGroupSettingsSession(
  userId: string,
  update: GroupSettingsSessionUpdate,
  ...scope: [] | [platformInstanceId: string]
): GroupSettingsSession | null {
  const platformInstanceId = scope.length === 0 ? undefined : scope[0]
  log.debug(
    { userId, stage: update.stage, targetContextId: update.targetContextId },
    'updateGroupSettingsSession called',
  )

  const session = getGroupSettingsSessionForScope(userId, platformInstanceId)
  if (session === null) {
    return null
  }

  const stageUpdate = update.stage === undefined ? {} : { stage: update.stage }
  const targetContextIdUpdate = update.targetContextId === undefined ? {} : { targetContextId: update.targetContextId }
  const nextSession: GroupSettingsSession = {
    ...session,
    ...stageUpdate,
    ...targetContextIdUpdate,
  }

  activeSessions.set(getSessionKey(userId, session.platformInstanceId), nextSession)
  log.info(
    { userId, stage: nextSession.stage, targetContextId: nextSession.targetContextId },
    'Updated group settings session',
  )

  if (update.targetContextId !== undefined) {
    emitUser('group_settings:target_changed', userId, {
      groupId: update.targetContextId,
      target: update.targetContextId,
    })
  }

  return nextSession
}

export function deleteGroupSettingsSession(userId: string, ...scope: [] | [platformInstanceId: string]): boolean {
  const platformInstanceId = scope.length === 0 ? undefined : scope[0]
  log.debug({ userId, platformInstanceId }, 'deleteGroupSettingsSession called')

  const entry = getSessionEntry(userId, platformInstanceId)
  const deleted = entry === null ? false : activeSessions.delete(entry.key)
  if (deleted) {
    log.info({ userId }, 'Deleted group settings session')
  }
  return deleted
}

export function getActiveGroupSettingsTarget(userId: string, ...scope: [] | [platformInstanceId: string]): string | null {
  const platformInstanceId = scope.length === 0 ? undefined : scope[0]
  log.debug({ userId, platformInstanceId }, 'getActiveGroupSettingsTarget called')

  const session = getGroupSettingsSessionForScope(userId, platformInstanceId)
  if (session === null || session.stage !== 'active') {
    return null
  }
  if (session.targetContextId === undefined) return null
  return session.targetContextId
}
