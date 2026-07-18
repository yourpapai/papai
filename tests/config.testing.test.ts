// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { getAllConfig, isConfigKey, isSensitiveKey, maskValue, setConfig } from '../src/config.js'
import {
  getAllConfig as shimmedGetAllConfig,
  isConfigKey as shimmedIsConfigKey,
  isSensitiveKey as shimmedIsSensitiveKey,
  maskValue as shimmedMaskValue,
  setConfig as shimmedSetConfig,
} from '../src/config.testing.js'

test('config.testing shim re-exports the production seams', () => {
  expect(shimmedIsSensitiveKey).toBe(isSensitiveKey)
  expect(shimmedSetConfig).toBe(setConfig)
  expect(shimmedIsConfigKey).toBe(isConfigKey)
  expect(shimmedGetAllConfig).toBe(getAllConfig)
  expect(shimmedMaskValue).toBe(maskValue)
})
