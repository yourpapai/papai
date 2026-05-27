// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import { z } from 'zod'

import { PlatformProviderTypeViewSchema } from '../../client/admin/instance-fetcher-schemas.js'
import { handlePlatformProviderTypes } from '../../src/debug/platform-provider-type-routes.js'

const route = (path: string, method = 'GET'): Response | null =>
  handlePlatformProviderTypes(new Request(`http://localhost${path}`, { method }), new URL(`http://localhost${path}`))

const expectArray = (value: unknown): readonly unknown[] => {
  expect(Array.isArray(value)).toBe(true)
  if (!Array.isArray(value)) throw new Error('expected array')
  return value
}

const expectObject = (value: unknown): object => {
  expect(typeof value).toBe('object')
  expect(value).not.toBeNull()
  expect(Array.isArray(value)).toBe(false)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected object')
  return value
}

const pick = (value: object, key: string): unknown => Reflect.get(value, key)

const readSchemaKeys = (entry: object): readonly unknown[] =>
  expectArray(pick(entry, 'instanceConfigSchema')).map((field) => pick(expectObject(field), 'key'))

describe('handlePlatformProviderTypes', () => {
  test('GET /api/platform-provider-types returns built-in platform descriptors', async () => {
    const res = route('/api/platform-provider-types')
    expect(res?.status).toBe(200)
    const body = expectArray(await res?.json()).map((entry) => expectObject(entry))

    expect(body.map((entry) => pick(entry, 'type'))).toEqual(['telegram', 'mattermost', 'discord'])
    expect(readSchemaKeys(expectObject(body.find((entry) => pick(entry, 'type') === 'mattermost')))).toEqual([
      'baseUrl',
      'token',
    ])
  })

  test('GET /api/platform-provider-types matches the admin client schema', async () => {
    const res = route('/api/platform-provider-types')
    expect(res?.status).toBe(200)

    const parsed = z.array(PlatformProviderTypeViewSchema).parse(await res?.json())

    expect(parsed.find((entry) => entry.type === 'mattermost')?.traits.observedGroupMessages).toBe('all')
  })
})
