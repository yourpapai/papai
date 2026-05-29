// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { builtinDescriptorSeeds } from '../../src/providers/builtin-descriptors.js'

test('builtinDescriptorSeeds contains only youtrack (kaneo is plugin-contributed)', () => {
  const types = builtinDescriptorSeeds.map((s) => s.type)
  expect(types).not.toContain('kaneo')
  expect(types).toContain('youtrack')
  expect(builtinDescriptorSeeds).toHaveLength(1)
})

test('youtrack builtin descriptor has the expected shape', () => {
  const youtrack = builtinDescriptorSeeds.find((s) => s.type === 'youtrack')
  expect(youtrack).toBeDefined()
  expect(youtrack?.displayName).toBe('YouTrack')
  expect(youtrack?.instanceConfigSchema.map((f) => f.key)).toEqual(['baseUrl'])
  expect(youtrack?.contextConfigSchema.find((f) => f.key === 'token')?.storageKey).toBe('youtrack_token')
  expect(youtrack?.traits.has('command-language:youtrack')).toBe(true)
})
