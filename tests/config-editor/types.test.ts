// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

/**
 * Tests for config-editor types
 */

import { describe, expect, test } from 'bun:test'

import type {
  ConfigEditorSession,
  CreateEditorSessionParams,
  EditorButton,
  EditorProcessResult,
  ValidationResult,
} from '../../src/config-editor/types.js'

describe('config-editor types', () => {
  test('ConfigEditorSession interface can be implemented', () => {
    const session: ConfigEditorSession = {
      userId: 'user123',
      storageContextId: 'ctx456',
      startedAt: new Date(),
      editingKey: 'kaneo_apikey',
      pendingValue: 'sk-test',
      originalMessageId: 'msg789',
    }

    expect(session.userId).toBe('user123')
    expect(session.editingKey).toBe('kaneo_apikey')
    expect(session.pendingValue).toBe('sk-test')
  })

  test('ConfigEditorSession works without optional fields', () => {
    const session: ConfigEditorSession = {
      userId: 'user123',
      storageContextId: 'ctx456',
      startedAt: new Date(),
      editingKey: 'youtrack_token',
    }

    expect(session.pendingValue).toBeUndefined()
    expect(session.originalMessageId).toBeUndefined()
  })

  test('CreateEditorSessionParams interface works', () => {
    const params: CreateEditorSessionParams = {
      userId: 'user123',
      storageContextId: 'ctx456',
      editingKey: 'timezone',
    }

    expect(params.editingKey).toBe('timezone')
  })

  test('EditorButton interface works', () => {
    const button: EditorButton = {
      text: 'Save',
      action: 'save',
      key: 'kaneo_apikey',
      style: 'primary',
    }

    expect(button.action).toBe('save')
    expect(button.style).toBe('primary')
  })

  test('EditorProcessResult interface works', () => {
    const result: EditorProcessResult = {
      handled: true,
      response: 'Value saved',
      buttons: [{ text: 'Back', action: 'back', style: 'secondary' }],
      editOriginal: false,
    }

    expect(result.handled).toBe(true)
    expect(result.editOriginal).toBe(false)
  })

  test('ValidationResult interface works for valid case', () => {
    const result: ValidationResult = {
      valid: true,
    }

    expect(result.valid).toBe(true)
    expect(result.error).toBeUndefined()
  })

  test('ValidationResult interface works for invalid case', () => {
    const result: ValidationResult = {
      valid: false,
      error: 'Invalid value',
    }

    expect(result.valid).toBe(false)
    expect(result.error).toBe('Invalid value')
  })
})
