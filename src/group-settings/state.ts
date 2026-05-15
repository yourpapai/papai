import { emitUser } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { GroupSettingsCommand, GroupSettingsSession, GroupSettingsSessionStage } from './types.js'

const log = logger.child({ scope: 'group-settings:state' })
const GROUP_SETTINGS_SESSION_TTL_MS = 30 * 60 * 1000
const activeSessions = new Map<string, GroupSettingsSession>()

type CreateGroupSettingsSessionParams = {
  userId: string
  command: GroupSettingsCommand
  stage: GroupSettingsSessionStage
  targetContextId?: string
}

type GroupSettingsSessionUpdate = {
  stage?: GroupSettingsSessionStage
  targetContextId?: string
}

const isExpired = (session: GroupSettingsSession): boolean =>
  Date.now() - session.startedAt.getTime() > GROUP_SETTINGS_SESSION_TTL_MS

export function createGroupSettingsSession(params: CreateGroupSettingsSessionParams): GroupSettingsSession {
  log.debug(
    { userId: params.userId, command: params.command, stage: params.stage },
    'createGroupSettingsSession called',
  )

  const session: GroupSettingsSession = {
    userId: params.userId,
    command: params.command,
    stage: params.stage,
    startedAt: new Date(),
    targetContextId: params.targetContextId,
  }

  activeSessions.set(params.userId, session)
  log.info({ userId: params.userId, command: params.command, stage: params.stage }, 'Created group settings session')
  return session
}

export function getGroupSettingsSession(userId: string): GroupSettingsSession | null {
  log.debug({ userId }, 'getGroupSettingsSession called')

  const session = activeSessions.get(userId)
  if (session === undefined) {
    return null
  }
  if (isExpired(session)) {
    activeSessions.delete(userId)
    log.info({ userId }, 'Expired group settings session')
    return null
  }
  return session
}

export function updateGroupSettingsSession(
  userId: string,
  update: GroupSettingsSessionUpdate,
): GroupSettingsSession | null {
  log.debug(
    { userId, stage: update.stage, targetContextId: update.targetContextId },
    'updateGroupSettingsSession called',
  )

  const session = getGroupSettingsSession(userId)
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

  activeSessions.set(userId, nextSession)
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

export function deleteGroupSettingsSession(userId: string): boolean {
  log.debug({ userId }, 'deleteGroupSettingsSession called')

  const deleted = activeSessions.delete(userId)
  if (deleted) {
    log.info({ userId }, 'Deleted group settings session')
  }
  return deleted
}

export function getActiveGroupSettingsTarget(userId: string): string | null {
  log.debug({ userId }, 'getActiveGroupSettingsTarget called')

  const session = getGroupSettingsSession(userId)
  if (session === null || session.stage !== 'active') {
    return null
  }
  return session.targetContextId ?? null
}
