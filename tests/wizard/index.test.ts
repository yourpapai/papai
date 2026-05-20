// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  cancelWizard,
  createWizard,
  getNextPrompt,
  getWizardSession,
  hasActiveWizard,
  processWizardMessage,
  resetWizardSession,
  validateAndSaveWizardConfig,
} from '../../src/wizard/index.js'

describe('wizard/index exports', () => {
  test('exports all required functions', () => {
    // State exports
    expect(typeof hasActiveWizard).toBe('function')
    expect(typeof getWizardSession).toBe('function')
    expect(typeof resetWizardSession).toBe('function')

    // Engine exports
    expect(typeof processWizardMessage).toBe('function')
    expect(typeof createWizard).toBe('function')
    expect(typeof getNextPrompt).toBe('function')
    expect(typeof cancelWizard).toBe('function')

    // Save exports
    expect(typeof validateAndSaveWizardConfig).toBe('function')
  })
})
