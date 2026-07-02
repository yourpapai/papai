// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { activate, jsonResponse } from './support.js'

// The real plugin host rejects (and errors the whole plugin) any tool registered
// during activate() that is not declared in the manifest's contributes.tools — and
// the settings UI relies on the manifest to advertise capabilities. The shared
// activate() test helper bypasses that check, so guard both directions here.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function manifestTools(): Promise<string[]> {
  const raw: unknown = await Bun.file(new URL('../../../plugins/acp/plugin.json', import.meta.url)).json()
  const contributes = isRecord(raw) ? raw['contributes'] : undefined
  const tools = isRecord(contributes) ? contributes['tools'] : undefined
  if (!Array.isArray(tools)) throw new Error('manifest contributes.tools missing')
  return tools.filter((t): t is string => typeof t === 'string')
}

describe('acp plugin manifest', () => {
  test('contributes.tools exactly matches the tools registered in activate()', async () => {
    const { tools } = activate(() => Promise.resolve(jsonResponse({}, 200)))
    const registered = [...tools.keys()].sort()
    const declared = [...(await manifestTools())].sort()
    expect(registered).toEqual(declared)
  })

  test('continue_session is declared (follow-up sessions)', async () => {
    expect(await manifestTools()).toContain('continue_session')
  })
})
