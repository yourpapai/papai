// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { GITHUB_CAPABILITIES, GITHUB_DEFAULT_BASE_URL } from '../../../plugins/task-provider-github/constants.js'

const manifestCapabilities = (): string[] => {
  const raw: unknown = JSON.parse(
    readFileSync(join(__dirname, '../../../plugins/task-provider-github/plugin.json'), 'utf8'),
  )
  if (typeof raw !== 'object' || raw === null) throw new Error('plugin.json is not an object')
  const capabilities: unknown = Reflect.get(raw, 'providerCapabilities')
  if (!Array.isArray(capabilities)) throw new Error('plugin.json providerCapabilities is not an array')
  const values: string[] = []
  for (const value of capabilities) {
    if (typeof value !== 'string') throw new Error('plugin.json providerCapabilities holds a non-string entry')
    values.push(value)
  }
  return values
}

describe('GITHUB_CAPABILITIES', () => {
  test('equals exactly the thirteen session-1+2 + activities/count capabilities', () => {
    expect(GITHUB_CAPABILITIES).toEqual(
      new Set([
        'projects.list',
        'projects.read',
        'comments.read',
        'comments.create',
        'comments.update',
        'comments.delete',
        'labels.list',
        'labels.create',
        'labels.update',
        'labels.delete',
        'labels.assign',
        'activities.read',
        'tasks.count',
      ]),
    )
  })

  test('equals the manifest providerCapabilities declarations as a set', () => {
    expect(new Set(manifestCapabilities())).toEqual(new Set([...GITHUB_CAPABILITIES]))
  })
})

describe('GITHUB_DEFAULT_BASE_URL', () => {
  test('is the public GitHub REST API base', () => {
    expect(GITHUB_DEFAULT_BASE_URL).toBe('https://api.github.com')
  })
})
