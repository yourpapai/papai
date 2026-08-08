// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { z } from 'zod'

import { YouTrackClassifiedError } from '../../../plugins/task-provider-youtrack/classify-error.js'
import { resolveDedicatedField } from '../../../plugins/task-provider-youtrack/dedicated-fields.js'
import type { ProjectCustomFieldSchema } from '../../../plugins/task-provider-youtrack/schemas/bundle.js'
import { providerError } from '../../../src/errors.js'

type PCF = z.infer<typeof ProjectCustomFieldSchema>

const field = (name: string, typeId: string, bundleType?: string, localizedName?: string): PCF =>
  ({
    $type: 'ProjectCustomField',
    field: { name, fieldType: { id: typeId }, ...(localizedName === undefined ? {} : { localizedName }) },
    ...(bundleType === undefined ? {} : { bundle: { id: 'b-1', $type: bundleType } }),
  }) as PCF

const captureError = (fn: () => unknown): YouTrackClassifiedError => {
  try {
    fn()
  } catch (e) {
    if (e instanceof YouTrackClassifiedError) return e
    throw e
  }
  throw new Error('expected resolveDedicatedField to throw')
}

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

  test('state disambiguates by canonical name across multiple state fields', () => {
    const english = resolveDedicatedField('state', [
      field('State', 'state[1]', 'StateBundle'),
      field('OldState', 'state[1]', 'StateBundle'),
    ])
    expect(english.field?.name).toBe('State')
    const russian = resolveDedicatedField('state', [
      field('Статус', 'state[1]', 'StateBundle'),
      field('OldState', 'state[1]', 'StateBundle'),
    ])
    expect(russian.field?.name).toBe('Статус')
  })

  test('assignee disambiguates by the Russian canonical name "ответственный"', () => {
    const resolved = resolveDedicatedField('user', [
      field('Ответственный', 'user[1]', 'UserBundle'),
      field('Other', 'user[1]', 'UserBundle'),
    ])
    expect(resolved.field?.name).toBe('Ответственный')
  })

  test('priority disambiguates by the Russian canonical name "приоритет"', () => {
    const resolved = resolveDedicatedField('priority', [field('Приоритет', 'enum[1]', 'EnumBundle'), TEAM])
    expect(resolved.field?.name).toBe('Приоритет')
  })

  test('priority with no enum field reports a no-priority-type-field error tagged customFields', () => {
    const err = captureError(() => resolveDedicatedField('priority', [STATE, USER]))
    expect(err.message).toBe(
      'No priority-type field exists in this project. Use describe_project to see the fields, then set the value via customFields by name.',
    )
    expect(err.appError).toEqual(providerError.validationFailed('customFields', err.message))
  })

  test('date resolves the sole date-typed field via the candidate shortcut', () => {
    const resolved = resolveDedicatedField('date', [field('StartDate', 'date[1]'), STATE])
    expect(resolved.field?.name).toBe('StartDate')
  })

  test('disambiguates by localized name when the field name is not canonical', () => {
    const localized = field('Foo', 'user[1]', 'UserBundle', 'Assignee')
    const resolved = resolveDedicatedField('user', [localized, field('Bar', 'user[1]', 'UserBundle')])
    expect(resolved.field?.name).toBe('Foo')
  })

  test('the multiple-candidate teaching error joins candidate names with "; "', () => {
    const err = captureError(() =>
      resolveDedicatedField('user', [
        field('Owner', 'user[1]', 'UserBundle'),
        field('Watcher', 'user[1]', 'UserBundle'),
      ]),
    )
    expect(err.message).toBe(
      'Multiple candidate fields for "user" (Owner; Watcher). Set the intended one explicitly via customFields by name.',
    )
  })

  test('candidate filter skips fields that lack a field object', () => {
    const fieldless: PCF = { $type: 'ProjectCustomField' }
    const resolved = resolveDedicatedField('state', [fieldless, field('Foo', 'state[1]', 'StateBundle')])
    expect(resolved.field?.name).toBe('Foo')
  })

  test('a single non-canonical enum field is not auto-resolved as priority', () => {
    const err = captureError(() => resolveDedicatedField('priority', [URGENCY]))
    expect(err.message).toBe(
      'Multiple candidate fields for "priority" (Срочность). Set the intended one explicitly via customFields by name.',
    )
  })

  test('two fields sharing one canonical name are reported as ambiguous', () => {
    const err = captureError(() =>
      resolveDedicatedField('user', [
        field('Assignee', 'user[1]', 'UserBundle'),
        field('Assignee', 'user[1]', 'UserBundle'),
      ]),
    )
    expect(err.message).toBe(
      'Multiple candidate fields for "user" (Assignee; Assignee). Set the intended one explicitly via customFields by name.',
    )
  })

  test('date disambiguates by canonical name across multiple date fields', () => {
    const english = resolveDedicatedField('date', [field('Due Date', 'date[1]'), field('Other', 'date[1]')])
    expect(english.field?.name).toBe('Due Date')
    const russian = resolveDedicatedField('date', [field('Дедлайн', 'date[1]'), field('Other', 'date[1]')])
    expect(russian.field?.name).toBe('Дедлайн')
  })
})
