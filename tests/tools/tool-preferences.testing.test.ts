// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { cycleDomain, cycleTool, partitionToolNames } from '../../src/tools/tool-preferences.js'
import {
  cycleDomain as shimmedCycleDomain,
  cycleTool as shimmedCycleTool,
  partitionToolNames as shimmedPartitionToolNames,
} from '../../src/tools/tool-preferences.testing.js'

test('tool-preferences.testing shim re-exports the production seams', () => {
  expect(shimmedPartitionToolNames).toBe(partitionToolNames)
  expect(shimmedCycleDomain).toBe(cycleDomain)
  expect(shimmedCycleTool).toBe(cycleTool)
})
