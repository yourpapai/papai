// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import { isKaneoProvider, listTaskLabels, listVisibleWorkspaceLabels } from '../../src/tools/kaneo-label-helpers.js'
import { createMockProvider } from './mock-provider.js'

describe('kaneo-label-helpers', () => {
  test('isKaneoProvider returns true only for Kaneo providers', () => {
    expect(isKaneoProvider(createMockProvider({ name: 'kaneo' }))).toBe(true)
    expect(isKaneoProvider(createMockProvider({ name: 'youtrack' }))).toBe(false)
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

  test('listTaskLabels only delegates for Kaneo providers with task label support', async () => {
    const kaneoProvider = createMockProvider({
      name: 'kaneo',
      listTaskLabels: mock(() => Promise.resolve([{ id: 'task-label-1', name: 'Feature', color: '#ff0000' }])),
    })
    const otherProvider = createMockProvider({ name: 'youtrack' })

    await expect(listTaskLabels(kaneoProvider, 'task-1')).resolves.toEqual([
      { id: 'task-label-1', name: 'Feature', color: '#ff0000' },
    ])
    await expect(listTaskLabels(otherProvider, 'task-1')).resolves.toEqual([])
  })
})
