// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { TaskInstance } from '../../src/instances/types.js'
import { getCapabilitiesForTaskInstance } from '../../src/providers/registry.js'

const taskInstance = (type: TaskInstance['type']): TaskInstance => ({
  id: `${type}-default`,
  type,
  config: { url: `https://${type}.invalid` },
  status: 'active',
  createdAt: 'now',
})

describe('provider registry capability lookup', () => {
  test('returns Kaneo task capabilities without requiring context credentials', () => {
    const capabilities = getCapabilitiesForTaskInstance(taskInstance('kaneo'))

    expect(capabilities.has('comments.read')).toBe(true)
    expect(capabilities.has('workItems.list')).toBe(false)
  })

  test('returns YouTrack task capabilities without requiring context credentials', () => {
    const capabilities = getCapabilitiesForTaskInstance(taskInstance('youtrack'))

    expect(capabilities.has('comments.read')).toBe(true)
    expect(capabilities.has('workItems.list')).toBe(true)
  })
})
