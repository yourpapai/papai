// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverPlugins } from '../../src/plugins/discovery.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'papai-plugin-discovery-'))
  tempDirs.push(dir)
  return dir
}

function writePlugin(
  root: string,
  dirName: string,
  manifestOverrides: Record<string, unknown> = {},
  entryPointSource = 'export default function createPlugin(){ return { activate() {} } }',
): void {
  const pluginDir = join(root, dirName)
  mkdirSync(pluginDir, { recursive: true })

  const manifest: Record<string, unknown> = {
    id: dirName,
    name: `Plugin ${dirName}`,
    version: '1.0.0',
    description: 'Test plugin',
    apiVersion: 1,
    ...manifestOverrides,
  }

  writeFileSync(join(pluginDir, 'plugin.json'), JSON.stringify(manifest), 'utf-8')
  const main = typeof manifest['main'] === 'string' ? manifest['main'] : 'index.ts'
  const entryPoint = join(pluginDir, main)
  const entryDir = entryPoint.slice(0, Math.max(entryPoint.lastIndexOf('/'), entryPoint.lastIndexOf('\\')))
  if (entryDir !== pluginDir) mkdirSync(entryDir, { recursive: true })
  writeFileSync(entryPoint, entryPointSource, 'utf-8')
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('discoverPlugins', () => {
  test('returns no plugins and no errors when plugins directory is missing', () => {
    const missingDir = join(makeTempDir(), 'does-not-exist')
    const result = discoverPlugins(missingDir)

    expect(result.plugins).toEqual([])
    expect(result.errors).toEqual([])
  })

  test('discovers valid plugins in deterministic directory/id order', () => {
    const root = makeTempDir()
    writePlugin(root, 'zeta')
    writePlugin(root, 'alpha')

    const result = discoverPlugins(root)

    expect(result.errors).toEqual([])
    expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(['alpha', 'zeta'])
  })

  test('reports invalid plugin.json as discovery error without throwing', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'broken')
    mkdirSync(pluginDir)
    writeFileSync(join(pluginDir, 'plugin.json'), '{ invalid-json', 'utf-8')

    const result = discoverPlugins(root)

    expect(result.plugins).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.directoryName).toBe('broken')
    expect(result.errors[0]?.reason).toContain('Invalid JSON')
  })

  test('reports plugin id mismatch with directory name', () => {
    const root = makeTempDir()
    writePlugin(root, 'my-dir', { id: 'different-id' })

    const result = discoverPlugins(root)

    expect(result.plugins).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.reason).toContain('does not match directory name')
  })

  test('rejects unsafe main paths with .. components', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'escape-main')
    mkdirSync(pluginDir)
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'escape-main',
        name: 'Escape Main',
        version: '1.0.0',
        description: 'unsafe path',
        apiVersion: 1,
        main: '../outside.ts',
      }),
      'utf-8',
    )

    const result = discoverPlugins(root)

    expect(result.plugins).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.reason).toContain('main must be a relative .ts or .js path without ".." components')
  })

  test('rejects unsafe absolute main paths', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'absolute-main')
    mkdirSync(pluginDir)
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'absolute-main',
        name: 'Absolute Main',
        version: '1.0.0',
        description: 'unsafe absolute path',
        apiVersion: 1,
        main: '/tmp/outside.ts',
      }),
      'utf-8',
    )

    const result = discoverPlugins(root)

    expect(result.plugins).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.reason).toContain('main must be a relative .ts or .js path without ".." components')
  })

  test('rejects symlinked plugin directories', () => {
    const root = makeTempDir()
    const realDir = join(root, 'real-plugin')
    writePlugin(root, 'real-plugin')
    symlinkSync(realDir, join(root, 'symlink-plugin'))

    const result = discoverPlugins(root)

    expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(['real-plugin'])
    expect(result.errors.some((error) => error.directoryName === 'symlink-plugin')).toBe(true)
  })

  test('rejects symlinked entry point that resolves outside plugin directory', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'outside-link')
    mkdirSync(pluginDir)

    const externalDir = makeTempDir()
    const externalEntry = join(externalDir, 'external.ts')
    writeFileSync(externalEntry, 'export default function createPlugin(){ return { activate() {} } }', 'utf-8')

    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'outside-link',
        name: 'Outside Link',
        version: '1.0.0',
        description: 'symlink escape',
        apiVersion: 1,
        main: 'index.ts',
      }),
      'utf-8',
    )
    symlinkSync(externalEntry, join(pluginDir, 'index.ts'))

    const result = discoverPlugins(root)

    expect(result.plugins).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.reason).toContain('resolves outside the plugin directory')
  })

  test('prevents duplicate valid plugin IDs by rejecting id/directory mismatches first', () => {
    const root = makeTempDir()
    writePlugin(root, 'alpha')
    writePlugin(root, 'beta', { id: 'alpha' })

    const result = discoverPlugins(root)

    expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(['alpha'])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.directoryName).toBe('beta')
    expect(result.errors[0]?.reason).toContain('does not match directory name')
  })
})
