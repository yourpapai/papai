// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config-editor public API
 */

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  createEditorSession,
  deleteEditorSession,
  getEditorSession,
  handleEditorCallback,
  handleEditorMessage,
  hasActiveEditor,
  parseCallbackData,
  serializeCallbackData,
  startEditor,
} from '../../src/config-editor/index.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

describe('config-editor public API', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  const userId = 'user123'
  const storageContextId = 'ctx456'

  test('exports startEditor function', () => {
    const result = startEditor(userId, storageContextId, 'kaneo_apikey')
    expect(result.handled).toBe(true)
  })

  test('exports state management functions', () => {
    expect(typeof createEditorSession).toBe('function')
    expect(typeof getEditorSession).toBe('function')
    expect(typeof hasActiveEditor).toBe('function')
    expect(typeof deleteEditorSession).toBe('function')
  })

  test('exports handler functions', () => {
    expect(typeof handleEditorCallback).toBe('function')
    expect(typeof handleEditorMessage).toBe('function')
    expect(typeof parseCallbackData).toBe('function')
    expect(typeof serializeCallbackData).toBe('function')
  })

  test('parseCallbackData works correctly', () => {
    expect(parseCallbackData('cfg:cancel')).toEqual({ action: 'cancel', key: null })
    expect(parseCallbackData('cfg:back')).toEqual({ action: 'back', key: null })
    expect(parseCallbackData('cfg:setup')).toEqual({ action: 'setup', key: null })
    expect(parseCallbackData('cfg:edit:kaneo_apikey')).toEqual({
      action: 'edit',
      key: 'kaneo_apikey',
    })
    expect(parseCallbackData('cfg:save:timezone')).toEqual({ action: 'save', key: 'timezone' })
    expect(parseCallbackData('invalid')).toEqual({ action: null, key: null })
  })

  test('serializeCallbackData works correctly', () => {
    expect(serializeCallbackData({ action: 'cancel' })).toBe('cfg:cancel')
    expect(serializeCallbackData({ action: 'back' })).toBe('cfg:back')
    expect(serializeCallbackData({ action: 'setup' })).toBe('cfg:setup')
    expect(serializeCallbackData({ action: 'edit', key: 'kaneo_apikey' })).toBe('cfg:edit:kaneo_apikey')
    expect(serializeCallbackData({ action: 'save', key: 'timezone' })).toBe('cfg:save:timezone')
  })

  test('serializeCallbackData encodes targetContextId when provided', () => {
    const data = serializeCallbackData({ action: 'edit', key: 'timezone' }, 'group-9')
    expect(data).toContain('cfg:edit:timezone@')
    expect(data).not.toBe('cfg:edit:timezone')

    const parsed = parseCallbackData(data)
    expect(parsed.action).toBe('edit')
    expect(parsed.key).toBe('timezone')
    expect(parsed.targetContextId).toBe('group-9')
  })

  test('parseCallbackData returns targetContextId from encoded callback', () => {
    const encoded = serializeCallbackData({ action: 'cancel' }, 'group-42')
    const parsed = parseCallbackData(encoded)
    expect(parsed.action).toBe('cancel')
    expect(parsed.targetContextId).toBe('group-42')
  })

  test('parseCallbackData returns undefined targetContextId for legacy callbacks', () => {
    expect(parseCallbackData('cfg:edit:timezone').targetContextId).toBeUndefined()
    expect(parseCallbackData('cfg:cancel').targetContextId).toBeUndefined()
  })
})
