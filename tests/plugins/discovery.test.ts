// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, win32 } from 'node:path'

import { discoverPlugins, discoveryPathOps, isPathInsideDirectory } from '../../src/plugins/discovery.js'

const tempDirs: string[] = []

function realpathWithInjectedLoop(
  path: Parameters<typeof discoveryPathOps.realpathSync>[0],
  originalRealpathSync: typeof discoveryPathOps.realpathSync,
  error: Error,
): string {
  const pathText = typeof path === 'string' ? path : path.toString()
  if (pathText.endsWith('helper.ts')) throw error
  return originalRealpathSync(path)
}

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
    main: 'index.ts',
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

  test('discovers built-in plugins under strict relative-only entry-graph rules', () => {
    const result = discoverPlugins(join(process.cwd(), 'plugins'))
    const pluginIds = result.plugins.map((plugin) => plugin.manifest.id)
    const errorDirectoryNames = new Set(result.errors.map((error) => error.directoryName))

    expect(errorDirectoryNames.has('task-provider-kaneo')).toBe(false)
    expect(errorDirectoryNames.has('task-provider-youtrack')).toBe(false)
    expect(errorDirectoryNames.has('synthetic-web-search')).toBe(false)
    expect(pluginIds.includes('task-provider-kaneo')).toBe(true)
    expect(pluginIds.includes('task-provider-youtrack')).toBe(true)
    expect(pluginIds.includes('synthetic-web-search')).toBe(true)
  })

  test('built-in strict entry files do not reference src framework types directly', () => {
    const repoRoot = process.cwd()
    const files = [
      'plugins/task-provider-kaneo/index.ts',
      'plugins/task-provider-kaneo/entry-runtime.ts',
      'plugins/task-provider-youtrack/index.ts',
      'plugins/task-provider-youtrack/entry-runtime.ts',
      'plugins/synthetic-web-search/index.ts',
    ]

    for (const relativePath of files) {
      const source = readFileSync(join(repoRoot, relativePath), 'utf-8')
      expect(source.includes('src/')).toBe(false)
      expect(source.includes("import('../../src/")).toBe(false)
      expect(source.includes('import("../../src/')).toBe(false)
    }
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

  test('reports plugin.json read failures distinctly from JSON parse failures', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'unreadable')
    mkdirSync(pluginDir)
    writeFileSync(join(pluginDir, 'plugin.json'), '{"id":"unreadable"}', 'utf-8')
    chmodSync(join(pluginDir, 'plugin.json'), 0)

    try {
      const result = discoverPlugins(root)

      expect(result.plugins).toEqual([])
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]?.directoryName).toBe('unreadable')
      expect(result.errors[0]?.reason).toContain('Failed to read plugin.json')
    } finally {
      chmodSync(join(pluginDir, 'plugin.json'), 0o644)
    }
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

  test('treats Windows-style containment checks portably', () => {
    expect(isPathInsideDirectory('C:\\plugins\\demo', 'C:\\plugins\\demo\\index.ts', win32)).toBe(true)
    expect(isPathInsideDirectory('C:\\plugins\\demo', 'C:\\plugins\\demo-two\\index.ts', win32)).toBe(false)
    expect(isPathInsideDirectory('C:\\plugins\\demo', 'C:\\plugins\\demo\\..\\escape.ts', win32)).toBe(false)
  })

  test('manifest hash changes when an imported local helper changes', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'hash-imported-helper')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'hash-imported-helper',
        name: 'Hash Imported Helper',
        version: '1.0.0',
        description: 'hash imported helpers',
        apiVersion: 1,
        main: 'index.ts',
      }),
      'utf-8',
    )
    writeFileSync(join(pluginDir, 'helper.ts'), 'export const value = 1\n', 'utf-8')
    writeFileSync(
      join(pluginDir, 'index.ts'),
      "import { value } from './helper.ts'\nexport default function createPlugin(){ return { activate(){ return value } } }\n",
      'utf-8',
    )

    const first = discoverPlugins(root)
    expect(first.errors).toEqual([])
    const firstHash = first.plugins[0]?.manifestHash
    expect(typeof firstHash).toBe('string')

    writeFileSync(join(pluginDir, 'helper.ts'), 'export const value = 2\n', 'utf-8')

    const second = discoverPlugins(root)
    expect(second.errors).toEqual([])
    expect(second.plugins[0]?.manifestHash).not.toBe(firstHash)
  })

  test('manifest hash changes when a side-effect import target changes', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'hash-side-effect-import')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'hash-side-effect-import',
        name: 'Hash Side Effect Import',
        version: '1.0.0',
        description: 'hash side effect imports',
        apiVersion: 1,
        main: 'index.ts',
      }),
      'utf-8',
    )
    writeFileSync(join(pluginDir, 'setup.ts'), 'globalThis.__sideEffect = 1\n', 'utf-8')
    writeFileSync(
      join(pluginDir, 'index.ts'),
      "import './setup.ts'\nexport default function createPlugin(){ return { activate() {} } }\n",
      'utf-8',
    )

    const first = discoverPlugins(root)
    expect(first.errors).toEqual([])
    const firstHash = first.plugins[0]?.manifestHash
    expect(typeof firstHash).toBe('string')

    writeFileSync(join(pluginDir, 'setup.ts'), 'globalThis.__sideEffect = 2\n', 'utf-8')

    const second = discoverPlugins(root)
    expect(second.errors).toEqual([])
    expect(second.plugins[0]?.manifestHash).not.toBe(firstHash)
  })

  test('manifest hash changes when an import.meta.require local target changes', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'hash-import-meta-require')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'hash-import-meta-require',
        name: 'Hash Import Meta Require',
        version: '1.0.0',
        description: 'hash import.meta.require helpers',
        apiVersion: 1,
        main: 'index.ts',
      }),
      'utf-8',
    )
    writeFileSync(join(pluginDir, 'helper.ts'), 'export const value = 1\n', 'utf-8')
    writeFileSync(
      join(pluginDir, 'runtime-bridge.ts'),
      "export const bridge = import.meta.require('./helper.ts')\n",
      'utf-8',
    )
    writeFileSync(
      join(pluginDir, 'index.ts'),
      "import { bridge } from './runtime-bridge.ts'\nexport default function createPlugin(){ return { activate(){ return bridge.value } } }\n",
      'utf-8',
    )

    const first = discoverPlugins(root)
    expect(first.errors).toEqual([])
    const firstHash = first.plugins[0]?.manifestHash
    expect(typeof firstHash).toBe('string')

    writeFileSync(join(pluginDir, 'helper.ts'), 'export const value = 2\n', 'utf-8')

    const second = discoverPlugins(root)
    expect(second.errors).toEqual([])
    expect(second.plugins[0]?.manifestHash).not.toBe(firstHash)
  })

  test('manifest hash is stable across different plugin root paths', () => {
    const firstRoot = makeTempDir()
    const secondRoot = makeTempDir()

    writePlugin(
      firstRoot,
      'stable-hash-plugin',
      { main: 'index.ts' },
      "import { value } from './helper.ts'\nexport default function createPlugin(){ return { activate(){ return value } } }\n",
    )
    writePlugin(
      secondRoot,
      'stable-hash-plugin',
      { main: 'index.ts' },
      "import { value } from './helper.ts'\nexport default function createPlugin(){ return { activate(){ return value } } }\n",
    )
    writeFileSync(join(firstRoot, 'stable-hash-plugin', 'helper.ts'), 'export const value = 1\n', 'utf-8')
    writeFileSync(join(secondRoot, 'stable-hash-plugin', 'helper.ts'), 'export const value = 1\n', 'utf-8')

    const first = discoverPlugins(firstRoot)
    const second = discoverPlugins(secondRoot)

    expect(first.errors).toEqual([])
    expect(second.errors).toEqual([])
    expect(first.plugins[0]?.manifestHash).toBe(second.plugins[0]?.manifestHash)
  })

  test('rejects plugin when imported path realpath throws', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'realpath-fails')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'realpath-fails',
        name: 'Realpath Fails',
        version: '1.0.0',
        description: 'test',
        apiVersion: 1,
        main: 'index.ts',
      }),
      'utf-8',
    )
    writeFileSync(join(pluginDir, 'helper.ts'), 'export const value = 1\n', 'utf-8')
    writeFileSync(
      join(pluginDir, 'index.ts'),
      "import { value } from './helper.ts'\nexport default function createPlugin(){ return { activate(){ return value } } }\n",
      'utf-8',
    )

    const originalRealpathSync = discoveryPathOps.realpathSync
    const helperLoopError = Object.assign(new Error('loop'), { code: 'ELOOP' })
    const realpathSpy = spyOn(discoveryPathOps, 'realpathSync').mockImplementation((path) =>
      realpathWithInjectedLoop(path, originalRealpathSync, helperLoopError),
    )

    try {
      const result = discoverPlugins(root)

      expect(result.plugins).toEqual([])
      expect(result.errors[0]?.reason).toContain('helper.ts')
    } finally {
      realpathSpy.mockRestore()
    }
  })

  test('rejects bare-module imports from plugin entry graph', () => {
    const root = makeTempDir()
    writePlugin(
      root,
      'bare-import-plugin',
      {},
      "import 'left-pad'\nexport default function createPlugin(){ return { activate() {} } }",
    )

    const result = discoverPlugins(root)

    expect(result.plugins).toEqual([])
    expect(result.errors[0]?.reason).toContain('Bare-module imports are not allowed in plugin entry graphs')
  })

  test('rejects plugin-owned dynamic imports that cannot be resolved deterministically', () => {
    const root = makeTempDir()
    writePlugin(
      root,
      'dynamic-import-plugin',
      { main: 'index.ts' },
      "export default function createPlugin(){ return { async activate(){ const name = './helper.ts'; await import(name) } } }",
    )

    const result = discoverPlugins(root)

    expect(result.plugins).toEqual([])
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.reason).toContain('dynamic import')
  })

  test('ignores import text inside string literals when scanning dynamic imports', () => {
    const root = makeTempDir()
    writePlugin(
      root,
      'quoted-import-text-plugin',
      { main: 'index.ts' },
      'export default function createPlugin(){ const note = "import(name)"; return { activate(){ return note } } }',
    )

    const result = discoverPlugins(root)

    expect(result.errors).toEqual([])
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.manifest.id).toBe('quoted-import-text-plugin')
  })

  test('ignores static import text inside ordinary string literals', () => {
    const root = makeTempDir()
    writePlugin(
      root,
      'quoted-static-import-text-plugin',
      { main: 'index.ts' },
      'export default function createPlugin(){ const note = "import \'./missing.ts\'"; return { activate(){ return note } } }',
    )

    const result = discoverPlugins(root)

    expect(result.errors).toEqual([])
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.manifest.id).toBe('quoted-static-import-text-plugin')
  })

  test('resolves deterministic literal dynamic imports', () => {
    const root = makeTempDir()
    writePlugin(
      root,
      'literal-dynamic-import-plugin',
      { main: 'index.ts' },
      "export default function createPlugin(){ return { async activate(){ const mod = await import('./helper.ts'); return mod.value } } }",
    )
    writeFileSync(join(root, 'literal-dynamic-import-plugin', 'helper.ts'), 'export const value = 1\n', 'utf-8')

    const result = discoverPlugins(root)

    expect(result.errors).toEqual([])
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.manifest.id).toBe('literal-dynamic-import-plugin')
  })

  test('resolves comment-bearing literal dynamic imports', () => {
    const root = makeTempDir()
    writePlugin(
      root,
      'comment-dynamic-import-plugin',
      { main: 'index.ts' },
      "export default function createPlugin(){ return { async activate(){ const first = await import(/*comment*/'./helper.ts'); const second = await import /*comment*/ ('./helper.ts'); return first.value + second.value } } }",
    )
    writeFileSync(join(root, 'comment-dynamic-import-plugin', 'helper.ts'), 'export const value = 1\n', 'utf-8')

    const result = discoverPlugins(root)

    expect(result.errors).toEqual([])
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.manifest.id).toBe('comment-dynamic-import-plugin')
  })

  test('manifest hash changes when template literal expressions contain deterministic dynamic imports', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'template-expression-dynamic-import')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'template-expression-dynamic-import',
        name: 'Template Expression Dynamic Import',
        version: '1.0.0',
        description: 'template expression dynamic import',
        apiVersion: 1,
        main: 'index.ts',
      }),
      'utf-8',
    )
    writeFileSync(join(pluginDir, 'helper.ts'), 'export const value = 1\n', 'utf-8')
    writeFileSync(
      join(pluginDir, 'index.ts'),
      "export default function createPlugin(){ const script = `${import('./helper.ts')}`; return { activate(){ return script.length } } }\n",
      'utf-8',
    )

    const first = discoverPlugins(root)
    expect(first.errors).toEqual([])
    const firstHash = first.plugins[0]?.manifestHash
    expect(typeof firstHash).toBe('string')

    writeFileSync(join(pluginDir, 'helper.ts'), 'export const value = 2\n', 'utf-8')

    const second = discoverPlugins(root)
    expect(second.errors).toEqual([])
    expect(second.plugins[0]?.manifestHash).not.toBe(firstHash)
  })

  test('accepts explicit mcp-only plugins without reading index.ts', () => {
    const root = makeTempDir()
    const pluginDir = join(root, 'mcp-only-plugin')
    mkdirSync(pluginDir, { recursive: true })
    writeFileSync(
      join(pluginDir, 'plugin.json'),
      JSON.stringify({
        id: 'mcp-only-plugin',
        name: 'MCP Only Plugin',
        version: '1.0.0',
        description: 'mcp only',
        apiVersion: 1,
        contributes: {
          tools: [],
          promptFragments: [],
          commands: [],
          jobs: [],
          configKeys: [],
          taskProviderTypes: [],
        },
        mcp: { transport: 'streamable-http', url: 'https://mcp.example.com' },
      }),
      'utf-8',
    )

    const result = discoverPlugins(root)

    expect(result.errors).toEqual([])
    expect(result.plugins).toHaveLength(1)
    expect(result.plugins[0]?.manifest.id).toBe('mcp-only-plugin')
    expect(result.plugins[0]?.entryPoint).toBe('')
  })
})
