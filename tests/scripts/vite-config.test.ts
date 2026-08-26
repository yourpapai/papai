// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import path from 'node:path'

import type { UserConfig, UserConfigFn } from 'vite'

const ROOT = path.resolve(import.meta.dir, '../..')

async function loadBuildConfig(outdirOverride?: string): Promise<UserConfig> {
  const previous = process.env['CLIENT_BUILD_OUTDIR']
  if (outdirOverride === undefined) delete process.env['CLIENT_BUILD_OUTDIR']
  else process.env['CLIENT_BUILD_OUTDIR'] = outdirOverride
  try {
    const configModule = await import('../../vite.config.js')
    const exported = configModule.default as UserConfig | UserConfigFn
    if (typeof exported === 'function') return await exported({ command: 'build', mode: 'production' })
    return exported
  } finally {
    if (previous === undefined) delete process.env['CLIENT_BUILD_OUTDIR']
    else process.env['CLIENT_BUILD_OUTDIR'] = previous
  }
}

function pluginNames(config: UserConfig): string[] {
  const entries = (Array.isArray(config.plugins) ? config.plugins : [config.plugins]) as unknown[]
  const names: string[] = []
  for (const entry of entries.flat(Infinity)) {
    if (typeof entry === 'object' && entry !== null && 'name' in entry && typeof entry.name === 'string') {
      names.push(entry.name)
    }
  }
  return names
}

function resolvedOutDir(config: UserConfig): string {
  return path.resolve(ROOT, config.build?.outDir ?? '')
}

function aliasReplacement(config: UserConfig, find: string): string | undefined {
  const alias = config.resolve?.alias
  if (alias === undefined) return undefined
  let replacement: string | undefined
  for (const [key, value] of Object.entries(alias)) {
    if (key === find && typeof value === 'string') replacement = value
  }
  return replacement
}

describe('vite.config', () => {
  test('registers the vite-plugin-svelte plugins', async () => {
    const config = await loadBuildConfig()

    const names = pluginNames(config)

    expect(names.some((name) => name.startsWith('vite-plugin-svelte'))).toBe(true)
  })

  test('aliases @client and @src at the repo roots, mirroring .storybook/main.ts', async () => {
    const config = await loadBuildConfig()

    expect(aliasReplacement(config, '@client')).toBe(path.join(ROOT, 'client'))
    expect(aliasReplacement(config, '@src')).toBe(path.join(ROOT, 'src'))
  })

  test('disables minification and outDir wiping', async () => {
    const config = await loadBuildConfig()

    expect(config.build?.minify).toBe(false)
    expect(config.build?.emptyOutDir).toBe(false)
  })

  test('defaults outDir to public/', async () => {
    const config = await loadBuildConfig()

    expect(resolvedOutDir(config)).toBe(path.join(ROOT, 'public'))
  })

  test('reads outDir from CLIENT_BUILD_OUTDIR', async () => {
    const config = await loadBuildConfig('vite-config-test-outdir')

    expect(resolvedOutDir(config)).toBe(path.resolve(ROOT, 'vite-config-test-outdir'))
  })

  test('treats an empty CLIENT_BUILD_OUTDIR as unset', async () => {
    const config = await loadBuildConfig('')

    expect(resolvedOutDir(config)).toBe(path.join(ROOT, 'public'))
  })
})
