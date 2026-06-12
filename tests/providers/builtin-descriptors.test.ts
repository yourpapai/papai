// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { builtinDescriptorSeeds } from '../../src/providers/builtin-descriptors.js'

test('builtinDescriptorSeeds is empty (both kaneo and youtrack are plugin-contributed)', () => {
  expect(builtinDescriptorSeeds).toHaveLength(0)
  const types = builtinDescriptorSeeds.map((s) => s.type)
  expect(types).not.toContain('kaneo')
  expect(types).not.toContain('youtrack')
})
