// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import { setCodingGuardrails } from '../../../src/coding-credentials/guardrails.js'
import { codingModule, codingWhoMayUseResolver } from '../../../src/modules/coding/module.js'
import { operatorAllowlistPort } from '../../../src/ports/operator-allowlist.js'
import { mockLogger, setupTestDb } from '../../utils/test-helpers.js'

describe('coding module', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('id is "coding"', () => {
    expect(codingModule.id).toBe('coding')
  })

  test('contributes no migrations in this phase', () => {
    expect(codingModule.migrations).toBeUndefined()
  })

  test('codingWhoMayUseResolver returns "members" when no guardrails are set', () => {
    expect(codingWhoMayUseResolver('pi-unset')).toBe('members')
  })

  test('codingWhoMayUseResolver returns the configured allowlist', () => {
    setCodingGuardrails('pi-x', { allowedAgents: ['claude'], whoMayUse: ['op-1'], forceSharedKey: false })
    expect(codingWhoMayUseResolver('pi-x')).toEqual(['op-1'])
  })

  test('onActivate registers the resolver into the operator-allowlist singleton', () => {
    setCodingGuardrails('pi-y', { allowedAgents: ['claude'], whoMayUse: ['op-2'], forceSharedKey: false })
    void codingModule.onActivate?.()
    expect(operatorAllowlistPort.resolve('pi-y')).toEqual(['op-2'])
  })
})
