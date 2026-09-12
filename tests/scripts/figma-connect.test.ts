// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { PNG } from 'pngjs'

import {
  BASE_KIT_COMPONENTS,
  RegistrySchema,
  canonicalDescription,
  checkRegistry,
  compareRenders,
  loadRegistry,
  parseRegistryText,
  planPayloads,
} from '../../scripts/figma-connect-lib.js'
import type { ComponentEntry, Registry } from '../../scripts/figma-connect-lib.js'
import { parseConnectArgs, runVerify } from '../../scripts/figma-connect.js'

const REGISTRY_PATH = new URL('../../scripts/figma/registry.json', import.meta.url).pathname

const component = (overrides: Partial<ComponentEntry> = {}): ComponentEntry => ({
  name: 'ui/Btn',
  figmaNode: '19:35',
  source: 'client/shared/ui/Btn.svelte',
  props: { Variant: 'variant', Label: 'children' },
  values: { Primary: 'primary', Secondary: 'secondary', Outline: 'outline', Ghost: 'ghost', Danger: 'danger' },
  ...overrides,
})

const registryWith = (overrides: Partial<Registry> = {}): Registry => ({
  version: 1,
  fileKey: 'o8B8JfxhFeOHqIfpv0eSdZ',
  components: BASE_KIT_COMPONENTS.map((name) =>
    component({ name, figmaNode: `1:${name.length}`, source: `src/${name}.tpl` }),
  ),
  screens: [],
  sections: [],
  ...overrides,
})

const registryWithoutFileKey = (): Omit<Registry, 'fileKey'> => {
  const { fileKey: _fileKey, ...rest } = registryWith()
  return rest
}

const always = (): boolean => true

const withoutComponentKey = (key: string): unknown => {
  const registry = registryWith()
  const [first, ...rest] = registry.components
  return { ...registry, components: [{ ...first, [key]: undefined }, ...rest] }
}

describe('RegistrySchema', () => {
  test('accepts the shipped registry.json', () => {
    const parsed = RegistrySchema.safeParse(JSON.parse(readFileSync(REGISTRY_PATH, 'utf8')))
    expect(parsed.success).toBe(true)
  })

  test('rejects entries missing node id, source, props, or values', () => {
    expect(RegistrySchema.safeParse(registryWith()).success).toBe(true)
    for (const key of ['figmaNode', 'source', 'props', 'values']) {
      expect(RegistrySchema.safeParse(withoutComponentKey(key)).success).toBe(false)
    }
  })

  test('requires a non-empty top-level fileKey', () => {
    expect(RegistrySchema.safeParse(registryWithoutFileKey()).success).toBe(false)
    expect(RegistrySchema.safeParse(registryWith({ fileKey: '' })).success).toBe(false)
  })

  test('rejects malformed figma node ids and wrong version', () => {
    expect(RegistrySchema.safeParse({ ...registryWith(), version: 2 }).success).toBe(false)
    expect(RegistrySchema.safeParse(registryWith({ components: [component({ figmaNode: 'btn' })] })).success).toBe(
      false,
    )
    expect(RegistrySchema.safeParse(registryWith({ components: [component({ figmaNode: '1:2:3' })] })).success).toBe(
      false,
    )
  })
})

describe('checkRegistry', () => {
  test('passes a complete registry whose sources exist', () => {
    expect(checkRegistry(registryWith(), always)).toEqual([])
  })

  test('reports a blank file key as a problem', () => {
    const problems = checkRegistry(registryWith({ fileKey: '' }), always)
    expect(problems.some((problem) => problem.entry === 'fileKey')).toBe(true)
  })

  test('names the entry and path of a missing source', () => {
    const registry = registryWith()
    const problems = checkRegistry(registry, (path) => path !== 'src/ui/Btn.tpl')
    expect(problems).toHaveLength(1)
    expect(problems[0]?.entry).toBe('ui/Btn')
    expect(problems[0]?.message).toContain('src/ui/Btn.tpl')
  })

  test('requires every base-kit component', () => {
    for (const dropped of BASE_KIT_COMPONENTS) {
      const registry = registryWith({ components: registryWith().components.filter((entry) => entry.name !== dropped) })
      const problems = checkRegistry(registry, always)
      expect(problems.some((problem) => problem.message.includes(dropped))).toBe(true)
    }
  })

  test('rejects a section entry referencing an unregistered screen', () => {
    const registry = registryWith({
      screens: [
        {
          name: 'screen/TaskProviderSection',
          figmaNode: '22:198',
          source: 'client/settings/sections/TaskProviderSection.svelte',
        },
      ],
      sections: [
        {
          screen: 'screen/Missing',
          section: 'Bind form',
          figmaNode: '22:199',
          source: 'client/settings/sections/TaskProviderSection.svelte',
        },
      ],
    })
    const problems = checkRegistry(registry, always)
    expect(problems.some((problem) => problem.message.includes('screen/Missing'))).toBe(true)
  })

  test('rejects a section entry when its screen source is missing', () => {
    const registry = registryWith({
      screens: [
        {
          name: 'screen/TaskProviderSection',
          figmaNode: '22:198',
          source: 'client/settings/sections/TaskProviderSection.svelte',
        },
      ],
      sections: [
        {
          screen: 'screen/TaskProviderSection',
          section: 'Bind form',
          figmaNode: '22:199',
          source: 'client/settings/sections/TaskProviderSection.svelte',
        },
      ],
    })
    const problems = checkRegistry(registry, (path) => !path.includes('TaskProviderSection'))
    expect(problems.length).toBeGreaterThanOrEqual(2)
    expect(problems.every((problem) => problem.message.includes('TaskProviderSection'))).toBe(true)
  })
})

describe('canonicalDescription', () => {
  test('component entries render source, props, and values in stable order', () => {
    expect(canonicalDescription(component())).toBe(
      'CODE: client/shared/ui/Btn.svelte | props: Variant→variant, Label→children | values: Primary→primary, Secondary→secondary, Outline→outline, Ghost→ghost, Danger→danger',
    )
  })

  test('empty dictionaries are omitted', () => {
    expect(canonicalDescription(component({ props: { Page: 'page' }, values: {} }))).toBe(
      'CODE: client/shared/ui/Btn.svelte | props: Page→page',
    )
  })

  test('section entries render the section clause', () => {
    expect(
      canonicalDescription({
        screen: 'screen/TaskProviderSection',
        section: 'Bind form',
        figmaNode: '22:199',
        source: 'client/settings/sections/TaskProviderSection.svelte',
      }),
    ).toBe('CODE: client/settings/sections/TaskProviderSection.svelte | section: Bind form')
  })
})

describe('loadRegistry', () => {
  test('loads and validates the shipped registry from disk', () => {
    const registry = loadRegistry()
    const names = registry.components.map((entry) => entry.name)
    for (const name of BASE_KIT_COMPONENTS) {
      expect(names).toContain(name)
    }
    expect(new Set(names).size).toBe(names.length)
  })

  test('throws a named error when a mapped source is missing', () => {
    expect(() => loadRegistry({ exists: (path) => path !== 'client/shared/ui/Btn.svelte' })).toThrow(
      /registry_source_missing.*ui\/Btn.*client\/shared\/ui\/Btn\.svelte/u,
    )
  })

  test('throws a named error on malformed registry JSON', () => {
    expect(() => parseRegistryText('not json')).toThrow(/registry_parse_failed/u)
    expect(() => parseRegistryText('{"version":2}')).toThrow(/registry_schema_invalid/u)
  })
})

describe('parseConnectArgs', () => {
  test('accepts the validate and plan subcommands', () => {
    expect(parseConnectArgs(['validate'])).toEqual({ command: 'validate' })
    expect(parseConnectArgs(['plan'])).toEqual({ command: 'plan' })
  })

  test('rejects a missing or unknown subcommand', () => {
    expect(() => parseConnectArgs([])).toThrow(/missing_command/u)
    expect(() => parseConnectArgs(['sync'])).toThrow(/unknown_command:sync/u)
  })

  test('rejects unknown flags', () => {
    expect(() => parseConnectArgs(['validate', '--fancy'])).toThrow(/unknown_flag:--fancy/u)
  })

  test('verify parses --story, --figma, and defaults the threshold', () => {
    expect(parseConnectArgs(['verify', '--story', '.storybook-shots/a-1.png', '--figma', 'figma.png'])).toEqual({
      command: 'verify',
      story: '.storybook-shots/a-1.png',
      figma: 'figma.png',
      threshold: 0.1,
    })
  })

  test('verify accepts --figma as a node id and --threshold as a number', () => {
    expect(parseConnectArgs(['verify', '--story', 'a.png', '--figma', '22:198', '--threshold', '0.05'])).toEqual({
      command: 'verify',
      story: 'a.png',
      figma: '22:198',
      threshold: 0.05,
    })
  })

  test('verify rejects missing story/figma and bad thresholds', () => {
    expect(() => parseConnectArgs(['verify'])).toThrow(/missing_story/u)
    expect(() => parseConnectArgs(['verify', '--story', 'a.png'])).toThrow(/missing_figma/u)
    expect(() => parseConnectArgs(['verify', '--story', 'a.png', '--figma', 'b.png', '--threshold', 'big'])).toThrow(
      /invalid_threshold/u,
    )
  })
})

describe('runVerify', () => {
  test('comparing a baseline against itself passes with diff 0', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-verify-'))
    const png = join(dir, 'same.png')
    writeFileSync(png, solidPng(8, 8, 1, 2, 3))
    const report = runVerify({ command: 'verify', story: png, figma: png, threshold: 0.1 })
    expect(report.status).toBe('pass')
    expect(report.diffPixels).toBe(0)
  })

  test('a missing story file is an explicit skip naming the side', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-verify-'))
    const png = join(dir, 'figma.png')
    writeFileSync(png, solidPng(8, 8, 1, 2, 3))
    const report = runVerify({ command: 'verify', story: join(dir, 'nope.png'), figma: png, threshold: 0.1 })
    expect(report.status).toBe('skip')
    expect(report.missingSide).toBe('story')
  })

  test('a figma node id is an explicit skip instructing an export', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-verify-'))
    const png = join(dir, 'story.png')
    writeFileSync(png, solidPng(8, 8, 1, 2, 3))
    const report = runVerify({ command: 'verify', story: png, figma: '22:198', threshold: 0.1 })
    expect(report.status).toBe('skip')
    expect(report.missingSide).toBe('figma')
    expect(report.reason).toContain('22:198')
  })

  test('a difference beyond the threshold fails with the artifact path under the report dir', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-verify-'))
    const story = join(dir, 'story.png')
    const figma = join(dir, 'figma.png')
    writeFileSync(story, solidPng(8, 8, 0, 0, 0))
    writeFileSync(figma, patchedPng(solidPng(8, 8, 0, 0, 0)))
    const report = runVerify({ command: 'verify', story, figma, threshold: 0.1 })
    expect(report.status).toBe('fail')
    expect(report.artifactPath).toContain('reports/figma-verify/')
  })
})

describe('planPayloads', () => {
  test('emits one deterministic payload per component, screen, and section', () => {
    const registry = registryWith({
      screens: [
        { name: 'screen/TaskProviderSection', figmaNode: '22:198', source: 'src/screen/TaskProviderSection.tpl' },
      ],
      sections: [
        {
          screen: 'screen/TaskProviderSection',
          section: 'Bind form',
          figmaNode: '22:199',
          source: 'src/screen/Bind-form.tpl',
        },
      ],
    })
    const componentDescription =
      'CODE: src/ui/Btn.tpl | props: Variant→variant, Label→children | values: Primary→primary, Secondary→secondary, Outline→outline, Ghost→ghost, Danger→danger'
    const payloads = planPayloads(registry)
    expect(payloads).toEqual([
      {
        name: 'ui/Btn',
        figmaNode: '1:6',
        fileKey: 'o8B8JfxhFeOHqIfpv0eSdZ',
        description: componentDescription.replace('src/ui/Btn.tpl', 'src/ui/Btn.tpl'),
      },
      {
        name: 'ui/Input',
        figmaNode: '1:8',
        fileKey: 'o8B8JfxhFeOHqIfpv0eSdZ',
        description: componentDescription.replace('Btn', 'Input'),
      },
      {
        name: 'ui/Field',
        figmaNode: '1:8',
        fileKey: 'o8B8JfxhFeOHqIfpv0eSdZ',
        description: componentDescription.replace('Btn', 'Field'),
      },
      {
        name: 'ui/PageHeader',
        figmaNode: '1:13',
        fileKey: 'o8B8JfxhFeOHqIfpv0eSdZ',
        description: componentDescription.replace('Btn', 'PageHeader'),
      },
      {
        name: 'ui/SidebarLink',
        figmaNode: '1:14',
        fileKey: 'o8B8JfxhFeOHqIfpv0eSdZ',
        description: componentDescription.replace('Btn', 'SidebarLink'),
      },
      {
        name: 'ui/TopBar',
        figmaNode: '1:9',
        fileKey: 'o8B8JfxhFeOHqIfpv0eSdZ',
        description: componentDescription.replace('Btn', 'TopBar'),
      },
      {
        name: 'screen/TaskProviderSection',
        figmaNode: '22:198',
        fileKey: 'o8B8JfxhFeOHqIfpv0eSdZ',
        description: 'CODE: src/screen/TaskProviderSection.tpl',
      },
      {
        name: 'Bind form',
        figmaNode: '22:199',
        fileKey: 'o8B8JfxhFeOHqIfpv0eSdZ',
        description: 'CODE: src/screen/Bind-form.tpl | section: Bind form',
      },
    ])
  })
})

const solidPng = (width: number, height: number, red: number, green: number, blue: number): Uint8Array => {
  const png = new PNG({ width, height })
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * 4
    png.data[offset] = red
    png.data[offset + 1] = green
    png.data[offset + 2] = blue
    png.data[offset + 3] = 255
  }
  return new Uint8Array(PNG.sync.write(png))
}

const patchedPng = (bytes: Uint8Array): Uint8Array => {
  const png = PNG.sync.read(Buffer.from(bytes))
  for (let index = 0; index < 32; index += 1) png.data[index] = 255 - (png.data[index] ?? 0)
  return new Uint8Array(PNG.sync.write(png))
}

describe('compareRenders', () => {
  test('identical renders pass with a measured diff of 0', () => {
    const png = solidPng(8, 8, 10, 20, 30)
    const outcome = compareRenders({ storyPng: png, figmaPng: solidPng(8, 8, 10, 20, 30), artifactPath: '/unused.png' })
    expect(outcome.status).toBe('pass')
    expect(outcome.diffPixels).toBe(0)
    expect(outcome.totalPixels).toBe(64)
    expect(outcome.ratio).toBe(0)
  })

  test('a difference beyond the threshold fails and writes the diff artifact', () => {
    const dir = mkdtempSync(join(tmpdir(), 'figma-verify-'))
    const artifactPath = join(dir, 'diff.png')
    const outcome = compareRenders({
      storyPng: solidPng(8, 8, 0, 0, 0),
      figmaPng: patchedPng(solidPng(8, 8, 0, 0, 0)),
      artifactPath,
    })
    expect(outcome.status).toBe('fail')
    expect(outcome.artifactPath).toBe(artifactPath)
    expect(outcome.diffPixels).toBeGreaterThan(0)
    expect(outcome.ratio).toBeGreaterThan(0.1)
    expect(readFileSync(artifactPath).byteLength).toBeGreaterThan(0)
  })

  test('a difference within the threshold passes with the measured value', () => {
    const outcome = compareRenders({
      storyPng: solidPng(100, 100, 0, 0, 0),
      figmaPng: patchedPng(solidPng(100, 100, 0, 0, 0)),
      artifactPath: '/unused.png',
      threshold: 0.5,
    })
    expect(outcome.status).toBe('pass')
    expect(outcome.ratio).toBeLessThanOrEqual(0.5)
  })

  test('a missing story render is an explicit skip naming the side', () => {
    const outcome = compareRenders({ figmaPng: solidPng(8, 8, 0, 0, 0), artifactPath: '/unused.png' })
    expect(outcome.status).toBe('skip')
    expect(outcome.missingSide).toBe('story')
    expect(outcome.reason).toContain('story')
  })

  test('a missing figma render is an explicit skip naming the side', () => {
    const outcome = compareRenders({ storyPng: solidPng(8, 8, 0, 0, 0), artifactPath: '/unused.png' })
    expect(outcome.status).toBe('skip')
    expect(outcome.missingSide).toBe('figma')
  })

  test('renders at different scales are normalized to the smaller size before diffing', () => {
    const outcome = compareRenders({
      storyPng: solidPng(16, 16, 12, 34, 56),
      figmaPng: solidPng(8, 8, 12, 34, 56),
      artifactPath: '/unused.png',
    })
    expect(outcome.status).toBe('pass')
    expect(outcome.totalPixels).toBe(64)
  })
})
