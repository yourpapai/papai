// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { patchByok } from '../../../client/settings/fetchers.js'
import { patchByok as shimmedPatchByok } from '../../../client/settings/fetchers.testing.js'

test('fetchers.testing shim re-exports the production seam', () => {
  expect(shimmedPatchByok).toBe(patchByok)
})
