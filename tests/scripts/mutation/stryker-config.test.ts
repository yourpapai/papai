// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const CONFIG_PATH = path.join(import.meta.dir, '..', '..', '..', 'stryker.config.json')

const isJsonObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const config: Record<string, unknown> = (() => {
  const parsed: unknown = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  if (!isJsonObject(parsed)) throw new Error('Expected stryker.config.json to contain a JSON object')
  return parsed
})()

describe('stryker.config.json', () => {
  test('keeps disableTypeChecks false so the sandbox leaves non-target source bytes untouched', () => {
    expect(config['disableTypeChecks']).toBe(false)
  })
})
