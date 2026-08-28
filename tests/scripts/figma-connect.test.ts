// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import {
  BASE_KIT_COMPONENTS,
  RegistrySchema,
  canonicalDescription,
  checkRegistry,
  loadRegistry,
  parseRegistryText,
  planPayloads,
} from '../../scripts/figma-connect-lib.js'
import type { ComponentEntry, Registry } from '../../scripts/figma-connect-lib.js'
import { parseConnectArgs } from '../../scripts/figma-connect.js'

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
  components: BASE_KIT_COMPONENTS.map((name) =>
    component({ name, figmaNode: `1:${name.length}`, source: `src/${name}.tpl` }),
  ),
  screens: [],
  sections: [],
  ...overrides,
})

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
    expect(registry.components.map((entry) => entry.name)).toEqual([...BASE_KIT_COMPONENTS])
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
        description: componentDescription.replace('src/ui/Btn.tpl', 'src/ui/Btn.tpl'),
      },
      { name: 'ui/Input', figmaNode: '1:8', description: componentDescription.replace('Btn', 'Input') },
      { name: 'ui/Field', figmaNode: '1:8', description: componentDescription.replace('Btn', 'Field') },
      { name: 'ui/PageHeader', figmaNode: '1:13', description: componentDescription.replace('Btn', 'PageHeader') },
      { name: 'ui/SidebarLink', figmaNode: '1:14', description: componentDescription.replace('Btn', 'SidebarLink') },
      { name: 'ui/TopBar', figmaNode: '1:9', description: componentDescription.replace('Btn', 'TopBar') },
      {
        name: 'screen/TaskProviderSection',
        figmaNode: '22:198',
        description: 'CODE: src/screen/TaskProviderSection.tpl',
      },
      { name: 'Bind form', figmaNode: '22:199', description: 'CODE: src/screen/Bind-form.tpl | section: Bind form' },
    ])
  })
})
