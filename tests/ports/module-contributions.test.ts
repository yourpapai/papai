// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  createModuleCommandRegistry,
  createModulePromptFragmentRegistry,
  moduleCommandRegistry,
  modulePromptFragmentRegistry,
  type ModuleCommand,
  type ModulePromptFragment,
} from '../../src/ports/module-contributions.js'

const cmd = (name: string): ModuleCommand => ({
  name,
  description: name,
  execute: (): Promise<void> => Promise.resolve(),
})
const frag = (name: string): ModulePromptFragment => ({ name, content: name })

describe('module contribution registries', () => {
  test('command registry registers/lists/clears', () => {
    const reg = createModuleCommandRegistry()
    reg.register('coding', [cmd('acp')])
    expect(reg.list().map((e) => `${e.moduleId}:${e.command.name}`)).toEqual(['coding:acp'])
    reg.clear()
    expect(reg.list()).toEqual([])
  })

  test('prompt-fragment registry registers/lists/clears', () => {
    const reg = createModulePromptFragmentRegistry()
    reg.register('coding', [frag('acp-hint')])
    expect(reg.list().map((e) => `${e.moduleId}:${e.fragment.name}`)).toEqual(['coding:acp-hint'])
    reg.clear()
    expect(reg.list()).toEqual([])
  })

  test('exposes shared singletons', () => {
    expect(typeof moduleCommandRegistry.list).toBe('function')
    expect(typeof modulePromptFragmentRegistry.list).toBe('function')
  })
})
