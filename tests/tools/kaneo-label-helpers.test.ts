// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import {
  listTaskLabels,
  listVisibleWorkspaceLabels,
  usesSeparateLabelReadApi,
} from '../../src/tools/kaneo-label-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('kaneo-label-helpers', () => {
  test('usesSeparateLabelReadApi returns true only for providers with the label-read trait', () => {
    expect(
      usesSeparateLabelReadApi(
        createMockProvider({ name: 'custom', traits: new Set(['task-label-read-requires-provider-specific-api']) }),
      ),
    ).toBe(true)
    expect(usesSeparateLabelReadApi(createMockProvider({ name: 'kaneo', traits: new Set() }))).toBe(false)
  })

  test('listVisibleWorkspaceLabels prefers getLabelByName when available', async () => {
    const getLabelByName = mock(() => Promise.resolve([{ id: 'label-1', name: 'Feature', color: '#ff0000' }]))
    const provider = createMockProvider({
      getLabelByName,
      listLabels: mock(() => Promise.resolve([])),
    })

    const result = await listVisibleWorkspaceLabels(provider, 'Feature')

    expect(result).toEqual([{ id: 'label-1', name: 'Feature', color: '#ff0000' }])
    expect(getLabelByName).toHaveBeenCalledWith('Feature')
  })

  test('listTaskLabels only delegates for providers with separate label-read support', async () => {
    const kaneoProvider = createMockProvider({
      name: 'kaneo',
      traits: new Set(['task-label-read-requires-provider-specific-api']),
      listTaskLabels: mock(() => Promise.resolve([{ id: 'task-label-1', name: 'Feature', color: '#ff0000' }])),
    })
    const spoofedProvider = createMockProvider({
      name: 'kaneo',
      traits: new Set(),
      listTaskLabels: mock(() => Promise.resolve([{ id: 'task-label-2', name: 'Bug', color: '#0000ff' }])),
    })

    await expect(listTaskLabels(kaneoProvider, 'task-1')).resolves.toEqual([
      { id: 'task-label-1', name: 'Feature', color: '#ff0000' },
    ])
    await expect(listTaskLabels(spoofedProvider, 'task-1')).resolves.toEqual([])
  })
})
