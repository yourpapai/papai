// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, mock, test } from 'bun:test'

import type { ProjectFieldDescriptor } from '../../src/providers/types.js'
import { makeDescribeProjectTool } from '../../src/tools/describe-project.js'
import { getToolExecutor, mockLogger } from '../utils/test-helpers.js'
import { createMockProvider } from './mock-provider.js'

const descriptors: ProjectFieldDescriptor[] = [
  { name: 'State', type: 'state', multi: false, required: true, allowedValues: ['Open', 'Fixed'] },
]

describe('describe_project', () => {
  test('returns projectId and fields from provider', async () => {
    mockLogger()
    const provider = createMockProvider({
      describeProjectFields: mock((_id: string) => Promise.resolve(descriptors)),
    })
    const tool = makeDescribeProjectTool(provider)
    const result = await getToolExecutor(tool)({ projectId: '0-1' }, { toolCallId: '1', messages: [] })
    expect(result).toEqual({ projectId: '0-1', fields: descriptors })
  })

  test('returns empty fields when provider returns empty array', async () => {
    mockLogger()
    const provider = createMockProvider({
      describeProjectFields: mock((_id: string) => Promise.resolve([])),
    })
    const tool = makeDescribeProjectTool(provider)
    const result = await getToolExecutor(tool)({ projectId: 'proj-1' }, { toolCallId: '1', messages: [] })
    expect(result).toEqual({ projectId: 'proj-1', fields: [] })
  })

  test('falls back to empty fields when describeProjectFields is undefined', async () => {
    mockLogger()
    const provider = createMockProvider({
      describeProjectFields: undefined,
    })
    const tool = makeDescribeProjectTool(provider)
    const result = await getToolExecutor(tool)({ projectId: 'proj-2' }, { toolCallId: '1', messages: [] })
    expect(result).toEqual({ projectId: 'proj-2', fields: [] })
  })
})
