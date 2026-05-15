// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Wizard state management
 * In-memory store for active wizard sessions
 */

import { emit } from '../debug/event-bus.js'
import { logger } from '../logger.js'
import type { WizardSession, WizardData } from './types.js'

const log = logger.child({ scope: 'wizard:state' })

/**
 * Parameters required to create a new wizard session
 */
export interface CreateWizardSessionParams {
  readonly userId: string
  readonly storageContextId: string
  readonly totalSteps: number
  readonly taskProvider: 'kaneo' | 'youtrack'
  readonly initialData?: WizardData
}

/**
 * Update object for wizard session
 */
export interface WizardSessionUpdate {
  readonly currentStep?: number
  readonly data?: Partial<WizardData>
  readonly skippedSteps?: number[]
}

// In-memory Map for active sessions
const activeSessions: Map<string, WizardSession> = new Map()

/**
 * Create a session key from userId and storageContextId
 */
const createSessionKey = (userId: string, storageContextId: string): string => `${userId}:${storageContextId}`

/**
 * Create and store a new wizard session
 * Returns existing session if one already exists for this user/context
 */
export const createWizardSession = (params: CreateWizardSessionParams): WizardSession => {
  const { userId, storageContextId, totalSteps, taskProvider, initialData } = params
  const key = createSessionKey(userId, storageContextId)

  const existingSession = activeSessions.get(key)
  if (existingSession !== undefined) {
    log.warn({ userId, storageContextId }, 'Wizard session already exists, returning existing')
    return existingSession
  }

  const session: WizardSession = {
    userId,
    storageContextId,
    startedAt: new Date(),
    currentStep: 0,
    totalSteps,
    data: initialData ?? {},
    skippedSteps: [],
    taskProvider,
  }

  activeSessions.set(key, session)
  emit('wizard:created', { userId, storageContextId, totalSteps, taskProvider })

  log.info(
    { userId, storageContextId, totalSteps, taskProvider, hasInitialData: initialData !== undefined },
    'Wizard session created',
  )

  return session
}

/**
 * Retrieve a wizard session by userId and storageContextId
 * Returns null if no session exists
 */
export const getWizardSession = (userId: string, storageContextId: string): WizardSession | null => {
  const key = createSessionKey(userId, storageContextId)
  const session = activeSessions.get(key)

  log.debug({ userId, storageContextId, hasSession: session !== undefined }, 'Getting wizard session')

  return session ?? null
}

/**
 * Check if a wizard session is active for the given user/context
 */
export const hasActiveWizard = (userId: string, storageContextId: string): boolean => {
  const key = createSessionKey(userId, storageContextId)
  const hasSession = activeSessions.has(key)

  log.debug({ userId, storageContextId, hasSession }, 'Checking active wizard')

  return hasSession
}

/**
 * Update a wizard session with new data
 * Throws error if session doesn't exist
 */
export const updateWizardSession = (userId: string, storageContextId: string, update: WizardSessionUpdate): void => {
  const key = createSessionKey(userId, storageContextId)
  const session = activeSessions.get(key)

  if (session === undefined) {
    log.error({ userId, storageContextId }, 'Attempted to update non-existent wizard session')
    throw new Error('Session not found')
  }

  const { currentStep, data, skippedSteps } = update

  if (currentStep !== undefined) {
    session.currentStep = currentStep
  }

  if (data !== undefined) {
    session.data = { ...session.data, ...data }
  }

  if (skippedSteps !== undefined) {
    session.skippedSteps = [...session.skippedSteps, ...skippedSteps]
  }

  emit('wizard:updated', { userId, storageContextId, currentStep: session.currentStep })

  log.info(
    { userId, storageContextId, currentStep, hasData: data !== undefined, hasSkipped: skippedSteps !== undefined },
    'Wizard session updated',
  )
}

/**
 * Reset wizard session to step 0 while preserving all collected data
 * Returns true if session was reset, false if no session exists
 */
export const resetWizardSession = (userId: string, storageContextId: string): boolean => {
  const key = createSessionKey(userId, storageContextId)
  const session = activeSessions.get(key)

  if (session === undefined) {
    log.warn({ userId, storageContextId }, 'Attempted to reset non-existent wizard session')
    return false
  }

  session.currentStep = 0
  session.skippedSteps = []
  emit('wizard:updated', { userId, storageContextId, currentStep: 0 })
  log.info(
    { userId, storageContextId, preservedKeys: Object.keys(session.data).length },
    'Wizard session reset to step 0',
  )

  return true
}

/**
 * Delete a wizard session
 * Returns true if a session was deleted, false otherwise
 */
export const deleteWizardSession = (userId: string, storageContextId: string): boolean => {
  const key = createSessionKey(userId, storageContextId)
  const existed = activeSessions.has(key)

  if (existed) {
    activeSessions.delete(key)
    emit('wizard:deleted', { userId, storageContextId })
    log.info({ userId, storageContextId }, 'Wizard session deleted')
  } else {
    log.warn({ userId, storageContextId }, 'Attempted to delete non-existent wizard session')
  }

  return existed
}

// 30 minutes
const WIZARD_SESSION_TTL_MS = 30 * 60 * 1000

/**
 * Clean up expired wizard sessions
 * Removes sessions older than WIZARD_SESSION_TTL_MS
 */
export type WizardSnapshot = {
  userId: string
  storageContextId: string
  startedAt: string
  currentStep: number
  totalSteps: number
  taskProvider: 'kaneo' | 'youtrack'
  skippedSteps: number[]
  dataKeys: string[]
}

export function getWizardSnapshots(userId: string): WizardSnapshot[] {
  const snapshots: WizardSnapshot[] = []
  for (const session of activeSessions.values()) {
    if (session.userId !== userId) continue
    snapshots.push({
      userId: session.userId,
      storageContextId: session.storageContextId,
      startedAt: session.startedAt.toISOString(),
      currentStep: session.currentStep,
      totalSteps: session.totalSteps,
      taskProvider: session.taskProvider,
      skippedSteps: [...session.skippedSteps],
      dataKeys: Object.keys(session.data),
    })
  }
  return snapshots
}

export function cleanupExpiredWizardSessions(): void {
  const now = Date.now()
  const expired: string[] = []

  for (const [key, session] of activeSessions) {
    if (now - session.startedAt.getTime() > WIZARD_SESSION_TTL_MS) {
      expired.push(key)
    }
  }

  for (const key of expired) {
    activeSessions.delete(key)
    log.debug({ sessionKey: key }, 'Expired wizard session removed')
  }

  if (expired.length > 0) {
    log.info({ expiredCount: expired.length }, 'Cleaned up expired wizard sessions')
  }
}
