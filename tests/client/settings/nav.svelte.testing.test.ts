// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { resetNavCollapse } from '../../../client/settings/nav.svelte.js'
import { resetNavCollapse as shimmedResetNavCollapse } from '../../../client/settings/nav.svelte.testing.js'

test('nav.svelte.testing shim re-exports the production seam', () => {
  expect(shimmedResetNavCollapse).toBe(resetNavCollapse)
})
