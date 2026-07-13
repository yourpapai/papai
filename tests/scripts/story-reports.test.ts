// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { removeStoryReport } from '../../scripts/story-reports.js'

test('removeStoryReport ignores a missing report', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-report-remove-'))
  try {
    await expect(removeStoryReport(path.join(root, 'missing.json'))).resolves.toBeUndefined()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('removeStoryReport propagates non-ENOENT cleanup failures with the path', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'papai-story-report-failure-'))
  const reportPath = path.join(root, 'manifest.json')
  mkdirSync(reportPath)
  try {
    await expect(removeStoryReport(reportPath)).rejects.toThrow(`Failed to remove story report ${reportPath}`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
