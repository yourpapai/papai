// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { deny } from '../../src/plugins/deny.js'

test('deny throws an error naming the plugin and the missing permission', () => {
  expect(() => deny('audio-transcribe', 'storage')).toThrow(
    "Plugin audio-transcribe does not have 'storage' permission",
  )
})
