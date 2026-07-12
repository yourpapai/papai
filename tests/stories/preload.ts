// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterAll } from 'bun:test'

import { installIoGuard, restoreIoGuard } from './harness/io-guard.js'

if (process.env['PAPAI_STORY_RUNNER'] !== '1') {
  throw new Error('Story preload requires PAPAI_STORY_RUNNER=1 and must be launched with bun test:stories')
}

installIoGuard()
afterAll(restoreIoGuard)
