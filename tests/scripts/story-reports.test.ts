// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { copyStoryCoverage, removeStoryReport, type SessionFileSystem } from '../../scripts/story/reports.js'

const sessionFs: SessionFileSystem = {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readlink,
  readdir: (target) => readdir(target, { withFileTypes: true }),
  realpath,
  rm,
  symlink,
}

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

test('copyStoryCoverage normalizes SF paths and writes the destination', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'papai-cov-'))
  try {
    const source = path.join(dir, 'lcov.info')
    const dest = path.join(dir, 'out', 'lcov.info')
    await writeFile(source, 'SF:/session/app/src/x.ts\nDA:1,1\nend_of_record')
    const copied = await copyStoryCoverage(source, dest, dir, sessionFs)
    expect(copied).toBe(true)
    expect(await readFile(dest, 'utf8')).toContain('SF:src/x.ts')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('copyStoryCoverage returns false when the source is missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'papai-cov-'))
  try {
    const copied = await copyStoryCoverage(path.join(dir, 'missing.info'), path.join(dir, 'out.info'), dir, sessionFs)
    expect(copied).toBe(false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
