// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for wizard state management
 */

import { describe, expect, test, beforeEach } from 'bun:test'
import { mock } from 'bun:test'

import { createTrackedLoggerMock, type TrackedLoggerMock } from '../utils/logger-mock.js'

// Import state module after mocking (dynamic import)
const { createWizardSession, getWizardSession, hasActiveWizard, updateWizardSession, deleteWizardSession } =
  await import('../../src/wizard/state.js')

describe('Wizard State Management', () => {
  const userId = 'user123'
  const storageContextId = 'ctx-456'

  let trackedLogger: TrackedLoggerMock

  beforeEach(() => {
    trackedLogger = createTrackedLoggerMock()
    void mock.module('../../src/logger.js', () => ({
      getLogLevel: trackedLogger.getLogLevel,
      logger: trackedLogger.logger,
    }))

    // Clean up any existing sessions before each test
    deleteWizardSession(userId, storageContextId)
  })

  describe('createWizardSession', () => {
    test('creates and stores a new session', async () => {
      const session = await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      expect(session).toBeDefined()
      expect(session.userId).toBe(userId)
      expect(session.storageContextId).toBe(storageContextId)
      expect(session.currentStep).toBe(0)
      expect(session.totalSteps).toBe(5)
      expect(session.taskProvider).toBe('kaneo')
      expect(session.data).toEqual({})
      expect(session.skippedSteps).toEqual([])
      expect(session.startedAt).toBeInstanceOf(Date)
    })

    test('returns existing session if one already exists', async () => {
      const firstSession = await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      const secondSession = await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 3,
        taskProvider: 'youtrack',
      })

      expect(secondSession).toBe(firstSession)
      expect(secondSession.totalSteps).toBe(5)
    })
  })

  describe('getWizardSession', () => {
    test('retrieves existing session', async () => {
      const created = await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      const retrieved = await getWizardSession(userId, storageContextId)

      expect(retrieved).toBeDefined()
      expect(retrieved).toBe(created)
    })

    test('returns null for non-existent session', async () => {
      const result = await getWizardSession('nonexistent', 'nonexistent')

      expect(result).toBeNull()
    })
  })

  describe('hasActiveWizard', () => {
    test('returns true when session exists', async () => {
      await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      const hasWizard = await hasActiveWizard(userId, storageContextId)

      expect(hasWizard).toBe(true)
    })

    test('returns false when no session exists', async () => {
      const hasWizard = await hasActiveWizard('nonexistent', 'nonexistent')

      expect(hasWizard).toBe(false)
    })
  })

  describe('updateWizardSession', () => {
    test('updates session data', async () => {
      const session = await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      await updateWizardSession(userId, storageContextId, {
        currentStep: 2,
        data: { llm_apikey: 'sk-test123' },
      })

      expect(session.currentStep).toBe(2)
      expect(session.data).toEqual({ llm_apikey: 'sk-test123' })
    })

    test('merges data with existing values', async () => {
      const session = await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      await updateWizardSession(userId, storageContextId, {
        data: { llm_apikey: 'sk-test123' },
      })

      await updateWizardSession(userId, storageContextId, {
        data: { timezone: 'UTC' },
      })

      expect(session.data).toEqual({
        llm_apikey: 'sk-test123',
        timezone: 'UTC',
      })
    })

    test('adds skipped steps', async () => {
      const session = await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      await updateWizardSession(userId, storageContextId, {
        skippedSteps: [1, 3],
      })

      expect(session.skippedSteps).toEqual([1, 3])
    })

    test('throws error when session does not exist', () => {
      expect(() => updateWizardSession('nonexistent', 'nonexistent', { currentStep: 1 })).toThrow('Session not found')
    })
  })

  describe('deleteWizardSession', () => {
    test('removes existing session', async () => {
      await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      const existedBefore = await hasActiveWizard(userId, storageContextId)
      expect(existedBefore).toBe(true)

      await deleteWizardSession(userId, storageContextId)

      const existsAfter = await hasActiveWizard(userId, storageContextId)
      expect(existsAfter).toBe(false)
    })

    test('returns false when deleting non-existent session', async () => {
      const result = await deleteWizardSession('nonexistent', 'nonexistent')

      expect(result).toBe(false)
    })

    test('returns true when deleting existing session', async () => {
      await createWizardSession({
        userId,
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      const result = await deleteWizardSession(userId, storageContextId)

      expect(result).toBe(true)
    })
  })

  describe('session isolation', () => {
    test('different users have isolated sessions', async () => {
      const session1 = await createWizardSession({
        userId: 'user1',
        storageContextId,
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      const session2 = await createWizardSession({
        userId: 'user2',
        storageContextId,
        totalSteps: 3,
        taskProvider: 'youtrack',
      })

      expect(session1).not.toBe(session2)
      expect(session1.totalSteps).toBe(5)
      expect(session2.totalSteps).toBe(3)
    })

    test('different storage contexts have isolated sessions', async () => {
      const session1 = await createWizardSession({
        userId,
        storageContextId: 'ctx1',
        totalSteps: 5,
        taskProvider: 'kaneo',
      })

      const session2 = await createWizardSession({
        userId,
        storageContextId: 'ctx2',
        totalSteps: 3,
        taskProvider: 'youtrack',
      })

      expect(session1).not.toBe(session2)
      expect(session1.storageContextId).toBe('ctx1')
      expect(session2.storageContextId).toBe('ctx2')
    })
  })
})
