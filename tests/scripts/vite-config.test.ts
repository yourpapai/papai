// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

import type { UserConfig, UserConfigFn } from 'vite'

const ROOT = path.resolve(import.meta.dir, '../..')

async function loadConfig(command: 'build' | 'serve'): Promise<UserConfig> {
  const configModule = await import('../../vite.config.js')
  const exported = configModule.default as UserConfig | UserConfigFn
  if (typeof exported !== 'function') return exported
  const config = await exported({ command, mode: 'development' })
  return config
}

async function loadBuildConfig(outdirOverride?: string): Promise<UserConfig> {
  const previous = process.env['CLIENT_BUILD_OUTDIR']
  if (outdirOverride === undefined) delete process.env['CLIENT_BUILD_OUTDIR']
  else process.env['CLIENT_BUILD_OUTDIR'] = outdirOverride
  try {
    const config = await loadConfig('build')
    return config
  } finally {
    if (previous === undefined) delete process.env['CLIENT_BUILD_OUTDIR']
    else process.env['CLIENT_BUILD_OUTDIR'] = previous
  }
}

interface NamedPluginEntry {
  name: string
  apply?: unknown
  transformIndexHtml?: unknown
}

function isNamedPluginEntry(entry: unknown): entry is NamedPluginEntry {
  return typeof entry === 'object' && entry !== null && 'name' in entry && typeof entry.name === 'string'
}

interface HtmlRewritePlugin extends NamedPluginEntry {
  transformIndexHtml: (html: string) => string | Promise<string>
}

function hasHtmlRewriteHook(entry: NamedPluginEntry): entry is HtmlRewritePlugin {
  return typeof entry.transformIndexHtml === 'function'
}

function flatPlugins(config: UserConfig): NamedPluginEntry[] {
  const entries = (Array.isArray(config.plugins) ? config.plugins : [config.plugins]) as unknown[]
  const plugins: NamedPluginEntry[] = []
  for (const entry of entries.flat(Infinity)) {
    if (isNamedPluginEntry(entry)) plugins.push(entry)
  }
  return plugins
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

    const names = flatPlugins(config).map((plugin) => plugin.name)

    expect(names.some((name) => name.startsWith('vite-plugin-svelte'))).toBe(true)
  })

  // scripts/build-client.ts gets the svelte plugin and the @client/@src
  // aliases from vite's auto-loaded root config, not from its inline override.
  // The image's build stage runs that script, so it must COPY the config in —
  // without it rolldown parses .svelte sources as JSX and the layer fails.
  test('Dockerfile build stage ships vite.config.ts to the client build', () => {
    const dockerfile = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8')

    expect(dockerfile).toMatch(
      /FROM base AS build[\s\S]*COPY[^\n]*vite\.config\.ts[^\n]*\n[\s\S]*RUN bun scripts\/build-client\.ts/u,
    )
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

  // The dev-only HTML rewrite: serve command exposes a plugin that repoints
  // each built page's script tag at the source entry module and swaps the
  // assembled css artifact for the three source stylesheets, so `vite` serves
  // the real client tree with HMR instead of the public/ artifacts.
  const DEV_PAGES: Array<{
    html: string
    artifact: string
    entry: string
    localCss: string
  }> = [
    {
      html: 'client/debug/debug.html',
      artifact: 'debug',
      entry: '/client/debug/index.ts',
      localCss: '/client/debug/debug.css',
    },
    {
      html: 'client/admin/admin.html',
      artifact: 'admin',
      entry: '/client/admin/index.ts',
      localCss: '/client/admin/admin.css',
    },
    {
      html: 'client/settings/settings.html',
      artifact: 'settings',
      entry: '/client/settings/index.ts',
      localCss: '/client/settings/settings.css',
    },
    // transcript.html is served under the /t.* artifact aliases in production.
    {
      html: 'client/transcript/transcript.html',
      artifact: 't',
      entry: '/client/transcript/index.ts',
      localCss: '/client/transcript/transcript.css',
    },
  ]

  async function devRewriteHook(): Promise<(html: string) => string | Promise<string>> {
    const config = await loadConfig('serve')

    const plugin = flatPlugins(config).find((candidate) => candidate.name === 'papai-dev-html-rewrite')
    if (plugin === undefined || !hasHtmlRewriteHook(plugin)) {
      throw new Error('serve config must expose papai-dev-html-rewrite with a transformIndexHtml hook')
    }
    expect(plugin.apply).toBe('serve')
    return plugin.transformIndexHtml
  }

  test('dev rewrite plugin is serve-scoped so builds skip it', async () => {
    await devRewriteHook()

    const buildConfig = await loadBuildConfig()
    const plugin = flatPlugins(buildConfig).find((candidate) => candidate.name === 'papai-dev-html-rewrite')
    // Vite filters plugins by `apply`; 'serve' keeps the rewrite out of builds.
    expect(plugin?.apply).toBe('serve')
  })

  test.each(DEV_PAGES)('rewrites $html for the dev server', async ({ html, artifact, entry, localCss }) => {
    const rewrite = await devRewriteHook()
    const source = fs.readFileSync(path.join(ROOT, html), 'utf8')

    const rewritten = await rewrite(source)

    // Module script at the source entry replaces the artifact script tag.
    expect(rewritten).toContain(`<script type="module" src="${entry}"></script>`)
    expect(rewritten).not.toContain(`src="/${artifact}.js"`)
    // Three source stylesheets, tokens before base before app-local css.
    const tokens = rewritten.indexOf('/client/shared/tokens.css')
    const base = rewritten.indexOf('/client/shared/base.css')
    const local = rewritten.indexOf(localCss)
    expect(tokens).toBeGreaterThanOrEqual(0)
    expect(base).toBeGreaterThan(tokens)
    expect(local).toBeGreaterThan(base)
    expect(rewritten).not.toContain(`href="/${artifact}.css"`)
    // Vite's dev pipeline applies component CSS by injecting inline <style>
    // elements, which the production `default-src 'self'` policy blocks, so
    // the served page must carry the relaxed dev CSP instead.
    expect(rewritten).not.toContain(`content="default-src 'self'"`)
    expect(rewritten).toContain(`content="default-src 'self'; style-src 'self' 'unsafe-inline'"`)
  })
})
