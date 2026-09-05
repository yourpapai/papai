// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { refreshModelsDevSnapshot, resetModelsDevSnapshotForTest } from '../../src/models-dev/client.js'
import {
  refreshModelsDevSnapshot as shimmedRefresh,
  resetModelsDevSnapshotForTest as shimmedReset,
} from '../../src/models-dev/client.testing.js'

test('client.testing shim re-exports the production seam', () => {
  expect(shimmedRefresh).toBe(refreshModelsDevSnapshot)
  expect(shimmedReset).toBe(resetModelsDevSnapshotForTest)
})
