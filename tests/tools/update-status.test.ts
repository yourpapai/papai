// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test, mock, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { makeUpdateStatusTool } from '../../src/tools/update-status.js'
import { getToolExecutor, mockLogger, schemaValidates } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('makeUpdateStatusTool', () => {
  beforeEach(() => {
    mockLogger()
    mock.restore()
  })

  test('returns tool with correct structure', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(tool.description).toContain('Update an existing status')
  })

  test('updates status name', async () => {
    const provider = createMockProvider({
      updateStatus: mock(() =>
        Promise.resolve({
          id: 'col-1',
          name: 'Updated Name',
        }),
      ),
    })

    const tool = makeUpdateStatusTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { projectId: 'proj-1', statusId: 'col-1', name: 'Updated Name' },
      { toolCallId: '1', messages: [], context: {} },
    )

    expect(result).toMatchObject({ id: 'col-1', name: 'Updated Name' })
  })

  test('passes confirm parameter to provider', async () => {
    const updateStatus = mock(
      (
        _projectId: string,
        _statusId: string,
        _params: { name?: string; icon?: string; color?: string; isFinal?: boolean },
        _confirm?: boolean,
      ) =>
        Promise.resolve({
          id: 'col-1',
          name: 'Updated',
        }),
    )
    const provider = createMockProvider({ updateStatus })

    const tool = makeUpdateStatusTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    await tool.execute(
      { projectId: 'proj-1', statusId: 'col-1', name: 'Updated', confirm: true },
      { toolCallId: '1', messages: [], context: {} },
    )

    expect(updateStatus).toHaveBeenCalledWith(
      'proj-1',
      'col-1',
      {
        name: 'Updated',
        icon: undefined,
        color: undefined,
        isFinal: undefined,
      },
      true,
    )
  })

  test('returns confirmation_required when provider returns shared bundle warning', async () => {
    const updateStatus = mock(() =>
      Promise.resolve({ status: 'confirmation_required' as const, message: 'Shared bundle' }),
    )
    const provider = createMockProvider({ updateStatus })

    const tool = makeUpdateStatusTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute(
      { projectId: 'proj-1', statusId: 'col-1', name: 'Updated' },
      { toolCallId: '1', messages: [], context: {} },
    )

    expect(result).toMatchObject({ status: 'confirmation_required' })
  })

  test('propagates status not found error', async () => {
    const provider = createMockProvider({
      updateStatus: mock(() => Promise.reject(new Error('Status not found'))),
    })

    const tool = makeUpdateStatusTool(provider)
    const promise = getToolExecutor(tool)(
      { projectId: 'proj-1', statusId: 'invalid', name: 'Test' },
      { toolCallId: '1', messages: [], context: {} },
    )
    await expect(promise).rejects.toThrow('Status not found')
    try {
      await promise
    } catch {
      // ignore
    }
  })

  test('validates projectId is required', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { statusId: 'col-1', name: 'Test' })).toBe(false)
  })

  test('validates statusId is required', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', name: 'Test' })).toBe(false)
  })

  test('validates at least one field is provided', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1' })).toBe(false)
  })

  // Positive-direction coverage for the .refine() "at least one field" rule.
  // Log-payload / description-string / confirmation-branch mutants are intentionally
  // not chased here — see docs/superpowers/specs/2026-07-25-update-status-test-quality-design.md.
  test('accepts input with only name set', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1', name: 'New' })).toBe(true)
  })

  test('accepts input with only icon set', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1', icon: 'flag' })).toBe(true)
  })

  test('accepts input with only color set', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1', color: '#ffffff' })).toBe(true)
  })

  test('accepts input with only isFinal set', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(schemaValidates(tool, { projectId: 'proj-1', statusId: 'col-1', isFinal: true })).toBe(true)
  })

  test('accepts input with all updatable fields', () => {
    const provider = createMockProvider()
    const tool = makeUpdateStatusTool(provider)
    expect(
      schemaValidates(tool, {
        projectId: 'proj-1',
        statusId: 'col-1',
        name: 'New',
        icon: 'flag',
        color: '#ffffff',
        isFinal: true,
      }),
    ).toBe(true)
  })
})
