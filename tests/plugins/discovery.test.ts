// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { discoverPlugins } from '../../src/plugins/discovery.js'

let tempDir: string | undefined

const makeTempDir = (): string => {
  tempDir = mkdtempSync(join(tmpdir(), 'papai-plugin-discovery-'))
  return tempDir
}

afterEach(() => {
  if (tempDir !== undefined) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = undefined
  }
})

describe('discoverPlugins', () => {
  test('discovers a valid plugin directory', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'hello-world')
    mkdirSync(pluginDir)
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'hello-world',
        name: 'Hello World',
        version: '1.0.0',
        description: 'A test plugin',
        apiVersion: 1,
      }),
    )
    writeFileSync(join(pluginDir, 'index.ts'), 'export default { activate() {} }')

    const result = discoverPlugins(root)

    expect(result.errors).toEqual([])
    expect(result.plugins.map((plugin) => plugin.manifest.id)).toEqual(['hello-world'])
  })
})
