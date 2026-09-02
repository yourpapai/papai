// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, it } from 'bun:test'

import * as afk from '../../afk-runner/src/index.js'

describe('afk-runner workspace barrel', () => {
  it('evaluates and exposes the substrate surface', () => {
    expect(typeof afk.STAGE_ORDER).toBe('object')
    expect(typeof afk.replayEvents).toBe('function')
  })
})
