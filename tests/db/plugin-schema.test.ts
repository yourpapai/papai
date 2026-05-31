// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { pluginAdminState, pluginContextState, pluginKv, pluginRuntimeEvents } from '../../src/db/plugin-schema.js'

describe('db/plugin-schema', () => {
  test('plugin schema tables are defined', () => {
    expect(pluginAdminState).toBeDefined()
    expect(pluginContextState).toBeDefined()
    expect(pluginKv).toBeDefined()
    expect(pluginRuntimeEvents).toBeDefined()
  })
})
