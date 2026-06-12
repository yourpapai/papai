// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'
import assert from 'node:assert/strict'

import { makeCreateLabelTool } from '../../src/tools/create-label.js'
import { createMockKaneoProvider } from './mock-provider.js'

describe('makeCreateLabelTool direct', () => {
  test('returns already_exists for Kaneo when reusable workspace label already exists', async () => {
    const createLabel = mock(() => Promise.resolve({ id: 'label-new', name: 'Feature', color: '#ff0000' }))
    const provider = createMockKaneoProvider({
      listLabels: mock(() => Promise.resolve([{ id: 'label-1', name: 'Feature', color: '#ff0000' }])),
      createLabel,
    })

    const tool = makeCreateLabelTool(provider)
    assert(tool.execute, 'Tool execute is undefined')
    const result: unknown = await tool.execute({ name: 'Feature' }, { toolCallId: '1', messages: [] })

    expect(result).toMatchObject({
      status: 'already_exists',
      labelName: 'Feature',
      existingLabelIds: ['label-1'],
    })
    expect(createLabel).not.toHaveBeenCalled()
  })
})
