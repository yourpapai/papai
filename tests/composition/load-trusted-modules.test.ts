// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { loadTrustedModules } from '../../src/composition/load-trusted-modules.js'
import type { Migration } from '../../src/db/migrate.js'
import { moduleCommandRegistry, modulePromptFragmentRegistry } from '../../src/ports/module-contributions.js'
import { moduleToolRegistry } from '../../src/ports/module-tools.js'
import type { TrustedModule } from '../../src/ports/module.js'
import { moduleSettingsRegistry } from '../../src/ports/settings-sections.js'

const noopMigration = (id: string): Migration => ({ id, up: (): void => {} })

describe('loadTrustedModules', () => {
  test('runs all migrations before any onActivate hook', async () => {
    const order: string[] = []
    const runMigrationsFn = (migs: readonly Migration[]): void => {
      for (const m of migs) order.push(`migrate:${m.id}`)
    }
    const modA: TrustedModule = {
      id: 'a',
      migrations: [noopMigration('9001_a')],
      onActivate: () => {
        order.push('activate:a')
      },
    }
    const modB: TrustedModule = {
      id: 'b',
      onActivate: () => {
        order.push('activate:b')
      },
    }
    await loadTrustedModules([modA, modB], runMigrationsFn)
    expect(order).toEqual(['migrate:9001_a', 'activate:a', 'activate:b'])
  })

  test('runs no migration for a module that declares none', async () => {
    let calls = 0
    await loadTrustedModules([{ id: 'y' }], () => {
      calls += 1
    })
    expect(calls).toBe(0)
  })

  test('awaits an async onActivate', async () => {
    const seen: string[] = []
    const mod: TrustedModule = {
      id: 'x',
      onActivate: async () => {
        await Promise.resolve()
        seen.push('done')
      },
    }
    await loadTrustedModules([mod], () => {})
    expect(seen).toEqual(['done'])
  })

  test("registers each module's tools into the moduleToolRegistry", async () => {
    moduleToolRegistry.clear()
    const mod: TrustedModule = {
      id: 'fixture',
      tools: [
        {
          name: 'do_it',
          description: 'do_it',
          inputSchema: z.object({}),
          execute: (): Promise<null> => Promise.resolve(null),
        },
      ],
    }
    await loadTrustedModules([mod], () => {})
    expect(moduleToolRegistry.list().map((e) => `${e.moduleId}:${e.tool.name}`)).toContain('fixture:do_it')
    moduleToolRegistry.clear()
  })

  test("registers each module's commands and prompt fragments", async () => {
    moduleCommandRegistry.clear()
    modulePromptFragmentRegistry.clear()
    const mod: TrustedModule = {
      id: 'fixture',
      commands: [{ name: 'go', description: 'go', execute: (): Promise<void> => Promise.resolve() }],
      promptFragments: [{ name: 'hint', content: 'hi' }],
    }
    await loadTrustedModules([mod], () => {})
    expect(moduleCommandRegistry.list().map((e) => `${e.moduleId}:${e.command.name}`)).toContain('fixture:go')
    expect(modulePromptFragmentRegistry.list().map((e) => `${e.moduleId}:${e.fragment.name}`)).toContain('fixture:hint')
    moduleCommandRegistry.clear()
    modulePromptFragmentRegistry.clear()
  })

  test("registers each module's settings sections", async () => {
    moduleSettingsRegistry.clear()
    const mod: TrustedModule = {
      id: 'fixture',
      settingsSections: [{ id: 'fixture-cfg', label: 'Fixture', fields: [{ key: 'url', label: 'URL' }] }],
    }
    await loadTrustedModules([mod], () => {})
    expect(moduleSettingsRegistry.list().map((s) => s.id)).toContain('fixture-cfg')
    moduleSettingsRegistry.clear()
  })
})
