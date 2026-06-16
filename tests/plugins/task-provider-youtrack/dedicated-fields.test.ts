// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { z } from 'zod'

import { resolveDedicatedField } from '../../../plugins/task-provider-youtrack/dedicated-fields.js'
import type { ProjectCustomFieldSchema } from '../../../plugins/task-provider-youtrack/schemas/bundle.js'

type PCF = z.infer<typeof ProjectCustomFieldSchema>

const field = (name: string, typeId: string, bundleType?: string): PCF =>
  ({
    $type: 'ProjectCustomField',
    field: { name, fieldType: { id: typeId } },
    ...(bundleType === undefined ? {} : { bundle: { id: 'b-1', $type: bundleType } }),
  }) as PCF

const STATE = field('Cтaтус', 'state[1]', 'StateBundle')
const USER = field('Oтветствeнный', 'user[*]', 'UserBundle')
const URGENCY = field('Срочность', 'enum[1]', 'EnumBundle')
const TEAM = field('Командa', 'enum[*]', 'EnumBundle')

describe('resolveDedicatedField', () => {
  test('status resolves to the sole state-typed field regardless of localized name', () => {
    const resolved = resolveDedicatedField('state', [STATE, USER, URGENCY, TEAM])
    expect(resolved.field?.name).toBe('Cтaтус')
  })

  test('assignee resolves to the sole user-typed field', () => {
    const resolved = resolveDedicatedField('user', [STATE, USER, URGENCY])
    expect(resolved.field?.name).toBe('Oтветствeнный')
  })

  test('priority requires a canonical name match and rejects ambiguous enums', () => {
    expect(() => resolveDedicatedField('priority', [URGENCY, TEAM])).toThrow(/priority/iu)
  })

  test('priority resolves an enum field literally named Priority', () => {
    const priority = field('Priority', 'enum[1]', 'EnumBundle')
    const resolved = resolveDedicatedField('priority', [priority, URGENCY, TEAM])
    expect(resolved.field?.name).toBe('Priority')
  })

  test('two same-type fields disambiguate by canonical name (Assignee)', () => {
    const assignee = field('Assignee', 'user[1]', 'UserBundle')
    const reviewer = field('Reviewer', 'user[1]', 'UserBundle')
    const resolved = resolveDedicatedField('user', [assignee, reviewer])
    expect(resolved.field?.name).toBe('Assignee')
  })

  test('two same-type fields with no canonical name throw a teaching error', () => {
    const a = field('Owner', 'user[1]', 'UserBundle')
    const b = field('Watcher', 'user[1]', 'UserBundle')
    expect(() => resolveDedicatedField('user', [a, b])).toThrow(/Owner|Watcher/u)
  })

  test('no field of the requested type throws a teaching error', () => {
    expect(() => resolveDedicatedField('state', [USER, URGENCY])).toThrow(/state/iu)
  })
})
