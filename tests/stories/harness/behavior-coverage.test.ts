// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'

import { DOCUMENTED_BEHAVIOR_IDS } from '../catalog/behavior-inventory.js'

test('documented behavior IDs are unique and source anchors occur exactly once', async () => {
  expect(new Set(DOCUMENTED_BEHAVIOR_IDS).size).toBe(DOCUMENTED_BEHAVIOR_IDS.length)
  const document = await Bun.file(`${import.meta.dir}/../../../docs/architecture/behaviors.md`).text()
  for (const id of DOCUMENTED_BEHAVIOR_IDS) {
    expect(document.split(`<!-- behavior:${id} -->`).length - 1).toBe(1)
  }
})
