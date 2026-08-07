// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { z } from 'zod'

import { YouTrackClassifiedError } from '../../../plugins/task-provider-youtrack/classify-error.js'
import {
  capAllowedValues,
  classifyFieldType,
  formatAllowed,
  normalize,
  resolveCustomFieldValue,
} from '../../../plugins/task-provider-youtrack/field-engine.js'
import type { FieldClassification } from '../../../plugins/task-provider-youtrack/field-engine.js'
import { ProjectCustomFieldSchema } from '../../../plugins/task-provider-youtrack/schemas/bundle.js'
import { providerError } from '../../../src/errors.js'

type ProjectCustomField = z.infer<typeof ProjectCustomFieldSchema>

const stateField = {
  $type: 'StateProjectCustomField',
  field: { name: 'State', fieldType: { id: 'state[1]' } },
  bundle: { id: 'sb-1', $type: 'StateBundle' },
}

const enumMultiField = {
  $type: 'EnumProjectCustomField',
  field: { name: 'Tags', fieldType: { id: 'enum[*]' } },
  bundle: { id: 'eb-1', $type: 'EnumBundle' },
}

const stateElements = [{ name: 'Open' }, { name: 'In Progress', localizedName: 'В работе' }, { name: 'Fixed' }]

const fetcher = (_segment: string, _bundleId: string): Promise<typeof stateElements> => Promise.resolve(stateElements)

const noFetch = (): Promise<never> => Promise.reject(new Error('bundle fetch unexpected'))

const fieldWith = (id: string, bundle?: { id: string; $type?: string }, name = 'F'): ProjectCustomField => ({
  $type: 'X',
  field: { name, fieldType: { id } },
  ...(bundle === undefined ? {} : { bundle }),
})

// Resolves a TYPE_TABLE row's bundleType into a field; the conditional lives here at
// module scope so vitest/no-conditional-in-test stays clear of the test callback.
const fieldForTable = (id: string, bundleType: string | undefined): ProjectCustomField =>
  bundleType === undefined ? fieldWith(id) : fieldWith(id, { id: 'b-1', $type: bundleType })

// Widen-then-delete is the lint-safe way to feed a ProjectCustomField with a
// bundle that omits `id` (oxlint no-unsafe-type-assertion blocks narrowing casts).
const fieldWithoutBundleId = (): ProjectCustomField => {
  const field: ProjectCustomField = {
    $type: 'StateProjectCustomField',
    field: { name: 'State', fieldType: { id: 'state[1]' } },
    bundle: { id: 'sb-1', $type: 'StateBundle' },
  }
  delete (field.bundle! as { id?: string }).id
  return field
}

const expectClassified = async (promise: Promise<unknown>): Promise<YouTrackClassifiedError> => {
  const error: unknown = await promise.catch((caught: unknown) => caught)
  expect(error).toBeInstanceOf(YouTrackClassifiedError)
  if (!(error instanceof YouTrackClassifiedError)) {
    throw new Error('Expected a YouTrackClassifiedError to be thrown')
  }
  return error
}

describe('classifyFieldType', () => {
  test('classifies a single state field', () => {
    const c = classifyFieldType(stateField)
    expect(c.kind).toBe('bundle')
    expect(c.label).toBe('state')
    expect(c.multi).toBe(false)
    expect(c.singleType).toBe('StateIssueCustomField')
    expect(c.bundleSegment).toBe('state')
  })

  test('classifies a multi enum field', () => {
    const c = classifyFieldType(enumMultiField)
    expect(c.multi).toBe(true)
    expect(c.multiType).toBe('MultiEnumIssueCustomField')
    expect(c.bundleSegment).toBe('enum')
  })

  // C1 + C3: every TYPE_TABLE row asserts kind/label/singleType/multiType/multi/bundleSegment.
  test.each<[string, string | undefined, FieldClassification]>([
    [
      'enum[1]',
      'EnumBundle',
      {
        label: 'enum',
        kind: 'bundle',
        multi: false,
        singleType: 'SingleEnumIssueCustomField',
        multiType: 'MultiEnumIssueCustomField',
        bundleSegment: 'enum',
      },
    ],
    [
      'state[1]',
      'StateBundle',
      {
        label: 'state',
        kind: 'bundle',
        multi: false,
        singleType: 'StateIssueCustomField',
        multiType: 'StateIssueCustomField',
        bundleSegment: 'state',
      },
    ],
    [
      'version[1]',
      'VersionBundle',
      {
        label: 'version',
        kind: 'bundle',
        multi: false,
        singleType: 'SingleVersionIssueCustomField',
        multiType: 'MultiVersionIssueCustomField',
        bundleSegment: 'version',
      },
    ],
    [
      'ownedfield[1]',
      'OwnedFieldBundle',
      {
        label: 'ownedField',
        kind: 'bundle',
        multi: false,
        singleType: 'SingleOwnedIssueCustomField',
        multiType: 'MultiOwnedIssueCustomField',
        bundleSegment: 'ownedField',
      },
    ],
    [
      'build[1]',
      'BuildBundle',
      {
        label: 'build',
        kind: 'bundle',
        multi: false,
        singleType: 'SingleBuildIssueCustomField',
        multiType: 'MultiBuildIssueCustomField',
        bundleSegment: 'build',
      },
    ],
    [
      'user[1]',
      undefined,
      {
        label: 'user',
        kind: 'user',
        multi: false,
        singleType: 'SingleUserIssueCustomField',
        multiType: 'MultiUserIssueCustomField',
        bundleSegment: undefined,
      },
    ],
    [
      'date[1]',
      undefined,
      {
        label: 'date',
        kind: 'date',
        multi: false,
        singleType: 'DateIssueCustomField',
        multiType: 'DateIssueCustomField',
        bundleSegment: undefined,
      },
    ],
    [
      'date and time[1]',
      undefined,
      {
        label: 'date',
        kind: 'date',
        multi: false,
        singleType: 'DateIssueCustomField',
        multiType: 'DateIssueCustomField',
        bundleSegment: undefined,
      },
    ],
    [
      'period[1]',
      undefined,
      {
        label: 'period',
        kind: 'period',
        multi: false,
        singleType: 'PeriodIssueCustomField',
        multiType: 'PeriodIssueCustomField',
        bundleSegment: undefined,
      },
    ],
    [
      'text',
      undefined,
      {
        label: 'text',
        kind: 'text',
        multi: false,
        singleType: 'TextIssueCustomField',
        multiType: 'TextIssueCustomField',
        bundleSegment: undefined,
      },
    ],
    [
      'string',
      undefined,
      {
        label: 'string',
        kind: 'simple',
        multi: false,
        singleType: 'SimpleIssueCustomField',
        multiType: 'SimpleIssueCustomField',
        bundleSegment: undefined,
      },
    ],
    [
      'integer',
      undefined,
      {
        label: 'integer',
        kind: 'simple',
        multi: false,
        singleType: 'SimpleIssueCustomField',
        multiType: 'SimpleIssueCustomField',
        bundleSegment: undefined,
      },
    ],
    [
      'float',
      undefined,
      {
        label: 'float',
        kind: 'simple',
        multi: false,
        singleType: 'SimpleIssueCustomField',
        multiType: 'SimpleIssueCustomField',
        bundleSegment: undefined,
      },
    ],
  ])('classifies every TYPE_TABLE row (%s)', (id, bundleType, expected) => {
    const c = classifyFieldType(fieldForTable(id, bundleType))
    expect(c).toEqual(expected)
  })

  // C2: parseFieldTypeId trimming + regex anchoring.
  test('trims surrounding whitespace from the whole fieldType id', () => {
    const c = classifyFieldType(fieldWith(' state[1] '))
    expect(c.kind).toBe('bundle')
    expect(c.label).toBe('state')
    expect(c.singleType).toBe('StateIssueCustomField')
  })

  test('trims whitespace inside the parsed base', () => {
    const c = classifyFieldType(fieldWith('State  [1]'))
    expect(c.kind).toBe('bundle')
    expect(c.label).toBe('state')
  })

  test('treats a fieldType id with trailing garbage after the qualifier as unknown', () => {
    const c = classifyFieldType(fieldWith('state[1]x'))
    expect(c.kind).toBe('unknown')
    expect(c.label).toBe('state[1]x')
  })

  test('anchors the qualifier match to the end of the id', () => {
    const c = classifyFieldType(fieldWith('junk\nstate[1]'))
    expect(c.kind).toBe('unknown')
    expect(c.label).toBe('junk\nstate[1]')
  })

  // C4 + C5: defensive optionals + the unknown branch.
  test('survives a missing field.field (no fieldType)', () => {
    const c = classifyFieldType({ $type: 'X' })
    expect(c).toEqual({ label: 'unknown', kind: 'unknown', multi: false })
  })

  test('survives a field.field without a fieldType (empty base)', () => {
    const c = classifyFieldType({ $type: 'X', field: { name: 'N' } })
    expect(c).toEqual({ label: 'unknown', kind: 'unknown', multi: false })
  })

  test('labels an unrecognized non-empty base with the base itself', () => {
    const c = classifyFieldType(fieldWith('gizmo[1]'))
    expect(c).toEqual({ label: 'gizmo', kind: 'unknown', multi: false })
  })

  test('does not compute a bundleSegment for non-bundle kinds even when a bundle is present', () => {
    const c = classifyFieldType({
      $type: 'X',
      field: { name: 'Due', fieldType: { id: 'date[1]' } },
      bundle: { id: 'b-1', $type: 'StateBundle' },
    })
    expect(c.kind).toBe('date')
    expect(c.bundleSegment).toBe(undefined)
  })

  test('returns an undefined bundleSegment for a bundle field that has no bundle', () => {
    const c = classifyFieldType(fieldWith('state[1]', undefined))
    expect(c).toEqual({
      label: 'state',
      kind: 'bundle',
      multi: false,
      singleType: 'StateIssueCustomField',
      multiType: 'StateIssueCustomField',
      bundleSegment: undefined,
    })
  })
})

describe('formatAllowed', () => {
  // C6
  test('joins values under the cap with ", "', () => {
    expect(formatAllowed(['a', 'b'])).toBe('a, b')
  })

  test('does not cap at exactly the cap boundary', () => {
    const fifty = Array.from({ length: 50 }, (_value, index) => `v${index}`)
    expect(formatAllowed(fifty)).toBe(fifty.join(', '))
  })

  test('caps overflow and appends an exact remainder summary', () => {
    const fifty = Array.from({ length: 50 }, (_value, index) => `v${index}`)
    const fiftyOne = [...fifty, 'extra']
    expect(formatAllowed(fiftyOne)).toBe(`${fifty.join(', ')}, …and 1 more`)
  })
})

describe('capAllowedValues', () => {
  // C7
  test('returns a copy of values under the cap', () => {
    expect(capAllowedValues(['a', 'b'])).toEqual(['a', 'b'])
  })

  test('does not cap at exactly the cap boundary', () => {
    const fifty = Array.from({ length: 50 }, (_value, index) => `v${index}`)
    expect(capAllowedValues(fifty)).toEqual(fifty)
  })

  test('caps overflow to the first cap values plus a remainder summary element', () => {
    const fifty = Array.from({ length: 50 }, (_value, index) => `v${index}`)
    const fiftyOne = [...fifty, 'extra']
    expect(capAllowedValues(fiftyOne)).toEqual([...fifty, '…and 1 more'])
  })
})

describe('normalize', () => {
  // C8
  test('trims and lowercases', () => {
    expect(normalize('  Hello  ')).toBe('hello')
  })
})

describe('resolveCustomFieldValue', () => {
  test('resolves a state value case-insensitively against the bundle', async () => {
    const payload = await resolveCustomFieldValue(stateField, 'in progress', { getBundleElements: fetcher })
    expect(payload).toEqual({ name: 'State', $type: 'StateIssueCustomField', value: { name: 'In Progress' } })
  })

  test('resolves a state value by localized (Russian) name', async () => {
    const payload = await resolveCustomFieldValue(stateField, 'В работе', { getBundleElements: fetcher })
    expect(payload.value).toEqual({ name: 'In Progress' })
  })

  test('throws a teaching error listing allowed values when no match', async () => {
    await expect(resolveCustomFieldValue(stateField, 'to-do', { getBundleElements: fetcher })).rejects.toThrow(
      /not a valid value.*Open, In Progress, Fixed/u,
    )
  })

  test('resolves multi enum values from a comma list', async () => {
    const payload = await resolveCustomFieldValue(enumMultiField, 'Open, Fixed', { getBundleElements: fetcher })
    expect(payload.$type).toBe('MultiEnumIssueCustomField')
    expect(payload.value).toEqual([{ name: 'Open' }, { name: 'Fixed' }])
  })

  test('builds a text payload without touching the bundle', async () => {
    const textField = { $type: 'TextProjectCustomField', field: { name: 'Notes', fieldType: { id: 'text' } } }
    const payload = await resolveCustomFieldValue(textField, 'hello', {
      getBundleElements: () => Promise.reject(new Error('should not fetch')),
    })
    expect(payload).toEqual({ name: 'Notes', $type: 'TextIssueCustomField', value: { text: 'hello' } })
  })

  test('throws a teaching error when an integer field gets a non-numeric value', async () => {
    const intField = {
      $type: 'SimpleProjectCustomField',
      field: { name: 'Story points', fieldType: { id: 'integer' } },
    }
    await expect(
      resolveCustomFieldValue(intField, 'lots', { getBundleElements: () => Promise.reject(new Error('no fetch')) }),
    ).rejects.toThrow(/Story points.*number/u)
  })

  test('resolves a valid integer field to a number', async () => {
    const intField = {
      $type: 'SimpleProjectCustomField',
      field: { name: 'Story points', fieldType: { id: 'integer' } },
    }
    const payload = await resolveCustomFieldValue(intField, '5', {
      getBundleElements: () => Promise.reject(new Error('no fetch')),
    })
    expect(payload).toEqual({ name: 'Story points', $type: 'SimpleIssueCustomField', value: 5 })
  })

  // C9: splitMulti trimming + empty-entry filtering.
  test('drops empty entries when splitting a multi-value list', async () => {
    const payload = await resolveCustomFieldValue(enumMultiField, 'Open,,Fixed', { getBundleElements: fetcher })
    expect(payload.value).toEqual([{ name: 'Open' }, { name: 'Fixed' }])
  })

  test('trims whitespace around each token of a multi-value list', async () => {
    const multiUser = {
      $type: 'UserProjectCustomField',
      field: { name: 'Assignees', fieldType: { id: 'user[*]' } },
    }
    const payload = await resolveCustomFieldValue(multiUser, ' alice , bob ', { getBundleElements: noFetch })
    expect(payload).toEqual({
      name: 'Assignees',
      $type: 'MultiUserIssueCustomField',
      value: [{ login: 'alice' }, { login: 'bob' }],
    })
  })

  // C10: matchBundleValue ambiguity guard.
  test('rejects an ambiguous bundle with two equally-named elements', async () => {
    const dupFetcher = (): Promise<{ name: string }[]> => Promise.resolve([{ name: 'Open' }, { name: 'Open' }])
    const err = await expectClassified(
      resolveCustomFieldValue(
        {
          $type: 'EnumProjectCustomField',
          field: { name: 'Tags', fieldType: { id: 'enum[1]' } },
          bundle: { id: 'eb-1', $type: 'EnumBundle' },
        },
        'open',
        { getBundleElements: dupFetcher },
      ),
    )
    expect(err.message).toBe('Field "Tags": "open" is not a valid value. Allowed values: Open, Open')
    expect(err.appError).toEqual(providerError.validationFailed('Tags', err.message))
  })

  // C11: missing-name guard.
  test('throws a teaching error carrying the customFields context when the field has no name', async () => {
    const err = await expectClassified(resolveCustomFieldValue({ $type: 'X' }, 'x', { getBundleElements: noFetch }))
    expect(err.message).toBe('Custom field is missing a name')
    expect(err.appError).toEqual(providerError.validationFailed('customFields', 'Custom field is missing a name'))
  })

  // C12 + C13: simple numeric guard + string passthrough.
  test('keeps a string-typed simple field as a raw string', async () => {
    const stringField = {
      $type: 'SimpleProjectCustomField',
      field: { name: 'Cost', fieldType: { id: 'string' } },
    }
    const payload = await resolveCustomFieldValue(stringField, 'hello', { getBundleElements: noFetch })
    expect(payload).toEqual({ name: 'Cost', $type: 'SimpleIssueCustomField', value: 'hello' })
  })

  test('parses a float-typed simple field into a number', async () => {
    const floatField = {
      $type: 'SimpleProjectCustomField',
      field: { name: 'Estimate', fieldType: { id: 'float' } },
    }
    const payload = await resolveCustomFieldValue(floatField, '1.5', { getBundleElements: noFetch })
    expect(payload).toEqual({ name: 'Estimate', $type: 'SimpleIssueCustomField', value: 1.5 })
  })

  // C14: date case.
  test('resolves a date field to a DateIssueCustomField with the parsed timestamp', async () => {
    const dateField = {
      $type: 'DateProjectCustomField',
      field: { name: 'Due', fieldType: { id: 'date' } },
    }
    const payload = await resolveCustomFieldValue(dateField, '2026-01-15', { getBundleElements: noFetch })
    expect(payload).toEqual({
      name: 'Due',
      $type: 'DateIssueCustomField',
      value: Date.parse('2026-01-15T12:00:00.000Z'),
    })
  })

  // C15: period case.
  test('resolves a period field to a PeriodIssueCustomField presentation', async () => {
    const periodField = {
      $type: 'PeriodProjectCustomField',
      field: { name: 'Estimate', fieldType: { id: 'period' } },
    }
    const payload = await resolveCustomFieldValue(periodField, '2w', { getBundleElements: noFetch })
    expect(payload).toEqual({ name: 'Estimate', $type: 'PeriodIssueCustomField', value: { presentation: '2w' } })
  })

  // C16: user case.
  test('resolves a single-user field to a login payload', async () => {
    const userField = {
      $type: 'UserProjectCustomField',
      field: { name: 'Assignee', fieldType: { id: 'user[1]' } },
    }
    const payload = await resolveCustomFieldValue(userField, 'alice', { getBundleElements: noFetch })
    expect(payload).toEqual({ name: 'Assignee', $type: 'SingleUserIssueCustomField', value: { login: 'alice' } })
  })

  // C17: bundle guard.
  test('rejects a bundle field that has no bundle', async () => {
    const err = await expectClassified(
      resolveCustomFieldValue(
        { $type: 'StateProjectCustomField', field: { name: 'State', fieldType: { id: 'state[1]' } } },
        'Open',
        { getBundleElements: noFetch },
      ),
    )
    expect(err.message).toBe('Field "State" has no resolvable value set on this project')
    expect(err.appError).toEqual(providerError.validationFailed('State', err.message))
  })

  test('rejects a bundle field whose bundle type yields no segment', async () => {
    const err = await expectClassified(
      resolveCustomFieldValue(
        {
          $type: 'StateProjectCustomField',
          field: { name: 'State', fieldType: { id: 'state[1]' } },
          bundle: { id: 'sb-1', $type: 'MysteryBundle' },
        },
        'Open',
        { getBundleElements: noFetch },
      ),
    )
    expect(err.message).toBe('Field "State" has no resolvable value set on this project')
    expect(err.appError).toEqual(providerError.validationFailed('State', err.message))
  })

  test('rejects a bundle field whose bundle carries no id', async () => {
    const err = await expectClassified(
      resolveCustomFieldValue(fieldWithoutBundleId(), 'Open', { getBundleElements: noFetch }),
    )
    expect(err.message).toBe('Field "State" has no resolvable value set on this project')
    expect(err.appError).toEqual(providerError.validationFailed('State', err.message))
  })

  // C18: unknown case.
  test('throws a teaching error naming the unsupported type id', async () => {
    const err = await expectClassified(
      resolveCustomFieldValue(
        { $type: 'FooProjectCustomField', field: { name: 'Weird', fieldType: { id: 'gizmo[1]' } } },
        'x',
        { getBundleElements: noFetch },
      ),
    )
    expect(err.message).toBe(
      'Field "Weird" has an unsupported type (gizmo[1]). Use describe_project to choose a settable field.',
    )
    expect(err.appError).toEqual(providerError.validationFailed('Weird', err.message))
  })

  test('falls back to "unknown" in the teaching error when the fieldType id is absent', async () => {
    const err = await expectClassified(
      resolveCustomFieldValue({ $type: 'FooProjectCustomField', field: { name: 'Weird' } }, 'x', {
        getBundleElements: noFetch,
      }),
    )
    expect(err.message).toBe(
      'Field "Weird" has an unsupported type (unknown). Use describe_project to choose a settable field.',
    )
    expect(err.appError).toEqual(providerError.validationFailed('Weird', err.message))
  })
})
