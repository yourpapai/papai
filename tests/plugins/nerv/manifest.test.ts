// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { activate, jsonResponse } from './support.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function manifestTools(): Promise<string[]> {
  const raw: unknown = await Bun.file(new URL('../../../plugins/nerv/plugin.json', import.meta.url)).json()
  const contributes = isRecord(raw) ? raw['contributes'] : undefined
  const tools = isRecord(contributes) ? contributes['tools'] : undefined
  if (!Array.isArray(tools)) throw new Error('manifest contributes.tools missing')
  return tools.filter((t): t is string => typeof t === 'string')
}

describe('nerv plugin manifest', () => {
  test('contributes.tools exactly matches the tools registered in activate()', async () => {
    const { tools } = activate(() => Promise.resolve(jsonResponse({}, 200)))
    expect([...tools.keys()].sort()).toEqual([...(await manifestTools())].sort())
  })

  test('registers the nerv command and nerv-hint fragment', () => {
    const { command, fragment } = activate(() => Promise.resolve(jsonResponse({}, 200)))
    expect(command?.name).toBe('nerv')
    expect(fragment?.name).toBe('nerv-hint')
  })
})
