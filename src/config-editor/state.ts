// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Config Editor state management
 * In-memory store for active config editor sessions
 */

import { randomBytes } from 'node:crypto'

import { logger } from '../logger.js'
import type { ConfigEditorSession, CreateEditorSessionParams } from './types.js'

const log = logger.child({ scope: 'config-editor:state' })

// In-memory Map for active sessions
const activeSessions: Map<string, ConfigEditorSession> = new Map()

// 30 minutes TTL
const EDITOR_SESSION_TTL_MS = 30 * 60 * 1000

const createSessionToken = (): string => randomBytes(4).toString('base64url')

/**
 * Create a session key from userId and storageContextId
 */
const createSessionKey = (userId: string, storageContextId: string): string => `${userId}:${storageContextId}`

/**
 * Create and store a new config editor session
 * Replaces any existing session for this user/context
 */
export const createEditorSession = (params: CreateEditorSessionParams): ConfigEditorSession => {
  const { userId, storageContextId, editingKey, originalMessageId } = params
  const key = createSessionKey(userId, storageContextId)

  if (activeSessions.has(key)) {
    log.warn({ userId, storageContextId, editingKey }, 'Editor session already exists, replacing existing')
  }

  const session: ConfigEditorSession = {
    userId,
    storageContextId,
    startedAt: new Date(),
    sessionToken: createSessionToken(),
    editingKey,
    originalMessageId,
  }

  activeSessions.set(key, session)

  log.info({ userId, storageContextId, editingKey }, 'Config editor session created')

  return session
}

/**
 * Retrieve a config editor session by userId and storageContextId
 * Returns null if no session exists or if session has expired
 */
export const getEditorSession = (userId: string, storageContextId: string): ConfigEditorSession | null => {
  const key = createSessionKey(userId, storageContextId)
  const session = activeSessions.get(key)

  if (session !== undefined && Date.now() - session.startedAt.getTime() > EDITOR_SESSION_TTL_MS) {
    activeSessions.delete(key)
    log.info({ userId, storageContextId }, 'Config editor session expired')
    return null
  }

  log.debug({ userId, storageContextId, hasSession: session !== undefined }, 'Getting editor session')

  return session ?? null
}

/**
 * Check if a config editor session is active for the given user/context
 */
export const hasActiveEditor = (userId: string, storageContextId: string): boolean => {
  return getEditorSession(userId, storageContextId) !== null
}

/**
 * Update interface for editor session
 */
export interface EditorSessionUpdate {
  pendingValue?: string
  originalMessageId?: string
  rotateSessionToken?: boolean
}

/**
 * Update a config editor session with new data
 * Throws error if session doesn't exist
 */
export const updateEditorSession = (userId: string, storageContextId: string, update: EditorSessionUpdate): void => {
  const key = createSessionKey(userId, storageContextId)
  const session = activeSessions.get(key)

  if (session === undefined) {
    log.error({ userId, storageContextId }, 'Attempted to update non-existent editor session')
    throw new Error('Editor session not found')
  }

  if (update.pendingValue !== undefined) {
    session.pendingValue = update.pendingValue
  }

  if (update.rotateSessionToken === true) {
    session.sessionToken = createSessionToken()
  }

  if (update.originalMessageId !== undefined) {
    session.originalMessageId = update.originalMessageId
  }

  log.info({ userId, storageContextId, hasPendingValue: update.pendingValue !== undefined }, 'Editor session updated')
}

/**
 * Delete a config editor session
 * Returns true if a session was deleted, false otherwise
 */
export const deleteEditorSession = (userId: string, storageContextId: string): boolean => {
  const key = createSessionKey(userId, storageContextId)
  const existed = activeSessions.has(key)

  if (existed) {
    activeSessions.delete(key)
    log.info({ userId, storageContextId }, 'Config editor session deleted')
  }

  return existed
}
