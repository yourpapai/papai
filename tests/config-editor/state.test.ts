// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config-editor state management
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createEditorSession,
  deleteEditorSession,
  getEditorSession,
  hasActiveEditor,
  updateEditorSession,
} from '../../src/config-editor/state.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('config-editor state', () => {
  const userId = 'user123'
  const storageContextId = 'ctx456'

  beforeEach(() => {
    mockLogger()
    // Clean up any existing sessions
    deleteEditorSession(userId, storageContextId)
  })

  describe('createEditorSession', () => {
    test('creates a new session', () => {
      const session = createEditorSession({
        userId,
        storageContextId,
        editingKey: 'llm_apikey',
      })

      expect(session).not.toBeNull()
      expect(session.userId).toBe(userId)
      expect(session.editingKey).toBe('llm_apikey')
      expect(session.startedAt).toBeInstanceOf(Date)
    })

    test('returns existing session if one already exists', () => {
      const first = createEditorSession({
        userId,
        storageContextId,
        editingKey: 'llm_apikey',
      })

      const second = createEditorSession({
        userId,
        storageContextId,
        editingKey: 'main_model',
      })

      expect(second).toBe(first)
      expect(second.editingKey).toBe('llm_apikey')
    })

    test('stores optional fields when provided', () => {
      const session = createEditorSession({
        userId,
        storageContextId,
        editingKey: 'kaneo_apikey',
        originalMessageId: 'msg789',
      })

      expect(session.originalMessageId).toBe('msg789')
    })

    test('creates separate sessions for different users', () => {
      const session1 = createEditorSession({
        userId: 'user1',
        storageContextId,
        editingKey: 'llm_apikey',
      })

      const session2 = createEditorSession({
        userId: 'user2',
        storageContextId,
        editingKey: 'main_model',
      })

      expect(session1.editingKey).toBe('llm_apikey')
      expect(session2.editingKey).toBe('main_model')
    })
  })

  describe('getEditorSession', () => {
    test('returns null when no session exists', () => {
      const session = getEditorSession(userId, storageContextId)
      expect(session).toBeNull()
    })

    test('returns session when it exists', () => {
      createEditorSession({
        userId,
        storageContextId,
        editingKey: 'timezone',
      })

      const session = getEditorSession(userId, storageContextId)
      expect(session).not.toBeNull()
      expect(session?.editingKey).toBe('timezone')
    })
  })

  describe('hasActiveEditor', () => {
    test('returns false when no session exists', () => {
      expect(hasActiveEditor(userId, storageContextId)).toBe(false)
    })

    test('returns true when session exists', () => {
      createEditorSession({
        userId,
        storageContextId,
        editingKey: 'llm_baseurl',
      })

      expect(hasActiveEditor(userId, storageContextId)).toBe(true)
    })
  })

  describe('updateEditorSession', () => {
    test('updates pending value', () => {
      createEditorSession({
        userId,
        storageContextId,
        editingKey: 'llm_apikey',
      })

      updateEditorSession(userId, storageContextId, { pendingValue: 'sk-newkey' })

      const session = getEditorSession(userId, storageContextId)
      expect(session?.pendingValue).toBe('sk-newkey')
    })

    test('throws error for non-existent session', () => {
      expect(() => {
        updateEditorSession(userId, storageContextId, { pendingValue: 'test' })
      }).toThrow('Editor session not found')
    })
  })

  describe('deleteEditorSession', () => {
    test('deletes existing session', () => {
      createEditorSession({
        userId,
        storageContextId,
        editingKey: 'main_model',
      })

      expect(hasActiveEditor(userId, storageContextId)).toBe(true)

      deleteEditorSession(userId, storageContextId)

      expect(hasActiveEditor(userId, storageContextId)).toBe(false)
    })

    test('returns false when no session exists', () => {
      const result = deleteEditorSession(userId, storageContextId)
      expect(result).toBe(false)
    })

    test('returns true when session was deleted', () => {
      createEditorSession({
        userId,
        storageContextId,
        editingKey: 'small_model',
      })

      const result = deleteEditorSession(userId, storageContextId)
      expect(result).toBe(true)
    })
  })
})
