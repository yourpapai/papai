// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { cappedRegistryPath, loadCappedRegistryStore } from '../../mutation-improve/src/capped-registry.js'
import { cleanupTempDirs, makeTempDir } from './test-helpers.js'

afterEach(cleanupTempDirs)

describe('capped-registry', () => {
  test('loads an empty registry when capped.json does not exist', async () => {
    const workDir = makeTempDir('capped-')
    const store = await loadCappedRegistryStore(workDir, 'run-1')
    expect(store.entries).toEqual([])
  })

  test('record persists an entry that a fresh load returns', async () => {
    const workDir = makeTempDir('capped-')
    const store = await loadCappedRegistryStore(workDir, 'run-1')
    await store.record('plugins/task-provider-kaneo/mappers.ts', 0.857)

    const reloaded = await loadCappedRegistryStore(workDir, 'run-2')
    expect(reloaded.entries).toHaveLength(1)
    const entry = reloaded.entries[0]
    expect(entry?.file).toBe('plugins/task-provider-kaneo/mappers.ts')
    expect(entry?.score).toBe(0.857)
    expect(entry?.runId).toBe('run-1')
    expect(entry?.cappedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/u)
  })

  test('entries reflect record immediately, without a reload', async () => {
    const workDir = makeTempDir('capped-')
    const store = await loadCappedRegistryStore(workDir, 'run-1')
    await store.record('src/a.ts', 0.8)
    expect(store.entries.map((e) => e.file)).toEqual(['src/a.ts'])
  })

  test('recording the same file twice overwrites the earlier entry', async () => {
    const workDir = makeTempDir('capped-')
    const store = await loadCappedRegistryStore(workDir, 'run-1')
    await store.record('src/a.ts', 0.8)
    await store.record('src/a.ts', 0.85)
    expect(store.entries).toHaveLength(1)
    expect(store.entries[0]?.score).toBe(0.85)
    const reloaded = await loadCappedRegistryStore(workDir, 'run-1')
    expect(reloaded.entries).toHaveLength(1)
    expect(reloaded.entries[0]?.score).toBe(0.85)
  })

  test('load throws on a corrupt registry rather than silently dropping cross-run memory', async () => {
    const workDir = makeTempDir('capped-')
    await writeFile(cappedRegistryPath(workDir), JSON.stringify({ 'src/a.ts': { score: 'high' } }))
    await expect(loadCappedRegistryStore(workDir, 'run-1')).rejects.toThrow()
  })

  test('registry file lives at <workDir>/capped.json', () => {
    expect(cappedRegistryPath('/w')).toBe(path.join('/w', 'capped.json'))
  })
})
