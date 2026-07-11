// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import {
  buildCustomFieldValue,
  fieldTypeToValueType,
  findIssueLink,
  linkMatches,
} from '../../plugins/mcp-youtrack/format-writes.js'

describe('mcp-youtrack write helpers', () => {
  describe('fieldTypeToValueType', () => {
    test('SingleUserIssueCustomField -> User', () => {
      expect(fieldTypeToValueType('SingleUserIssueCustomField')).toBe('User')
    })

    test('MultiUserIssueCustomField -> User', () => {
      expect(fieldTypeToValueType('MultiUserIssueCustomField')).toBe('User')
    })

    test('SingleGroupIssueCustomField -> UserGroup', () => {
      expect(fieldTypeToValueType('SingleGroupIssueCustomField')).toBe('UserGroup')
    })

    test('StateIssueCustomField -> StateBundleElement', () => {
      expect(fieldTypeToValueType('StateIssueCustomField')).toBe('StateBundleElement')
    })

    test('SingleVersionIssueCustomField -> VersionBundleElement', () => {
      expect(fieldTypeToValueType('SingleVersionIssueCustomField')).toBe('VersionBundleElement')
    })

    test('SingleBuildIssueCustomField -> BuildBundleElement', () => {
      expect(fieldTypeToValueType('SingleBuildIssueCustomField')).toBe('BuildBundleElement')
    })

    test('SingleOwnedIssueCustomField -> OwnedBundleElement', () => {
      expect(fieldTypeToValueType('SingleOwnedIssueCustomField')).toBe('OwnedBundleElement')
    })

    test('MultiEnumIssueCustomField -> EnumBundleElement', () => {
      expect(fieldTypeToValueType('MultiEnumIssueCustomField')).toBe('EnumBundleElement')
    })

    test('SimpleIssueCustomField -> EnumBundleElement (fallback)', () => {
      expect(fieldTypeToValueType('SimpleIssueCustomField')).toBe('EnumBundleElement')
    })
  })

  describe('buildCustomFieldValue', () => {
    test('single enum field wraps name', () => {
      expect(buildCustomFieldValue('SingleEnumIssueCustomField', 'High')).toEqual({
        $type: 'EnumBundleElement',
        name: 'High',
      })
    })

    test('single user field wraps login', () => {
      expect(buildCustomFieldValue('SingleUserIssueCustomField', 'jdoe')).toEqual({
        $type: 'User',
        login: 'jdoe',
      })
    })

    test('multi enum field maps array of values', () => {
      expect(buildCustomFieldValue('MultiEnumIssueCustomField', ['a', 'b'])).toEqual([
        { $type: 'EnumBundleElement', name: 'a' },
        { $type: 'EnumBundleElement', name: 'b' },
      ])
    })

    test('multi enum field wraps non-array value in array', () => {
      expect(buildCustomFieldValue('MultiEnumIssueCustomField', 'a')).toEqual([
        { $type: 'EnumBundleElement', name: 'a' },
      ])
    })

    test('single enum field with array value picks value[0]', () => {
      expect(buildCustomFieldValue('SingleEnumIssueCustomField', ['x', 'y'])).toEqual({
        $type: 'EnumBundleElement',
        name: 'x',
      })
    })

    test('state field with null value returns null', () => {
      expect(buildCustomFieldValue('StateIssueCustomField', null)).toBeNull()
    })

    test('period field with numeric value returns minutes', () => {
      expect(buildCustomFieldValue('PeriodIssueCustomField', 90)).toEqual({ minutes: 90 })
    })

    test('period field with string value returns presentation', () => {
      expect(buildCustomFieldValue('PeriodIssueCustomField', '1h 30m')).toEqual({ presentation: '1h 30m' })
    })

    test('text field wraps text', () => {
      expect(buildCustomFieldValue('TextIssueCustomField', 'hello')).toEqual({ text: 'hello' })
    })

    test('simple field passes value through', () => {
      expect(buildCustomFieldValue('SimpleIssueCustomField', 42)).toBe(42)
    })

    test('date field passes value through', () => {
      expect(buildCustomFieldValue('DateIssueCustomField', '2026-01-01')).toBe('2026-01-01')
    })

    test('null short-circuits before the enum/user branch', () => {
      expect(buildCustomFieldValue('SingleUserIssueCustomField', null)).toBeNull()
    })
  })

  describe('linkMatches / findIssueLink', () => {
    test('finds link by direction label matching linkType name', () => {
      const links = [
        {
          id: 's1',
          linkType: { name: 'relates', sourceToTarget: 'relates to', targetToSource: 'relates to' },
        },
      ]
      expect(findIssueLink(links, 'relates', 'sourceToTarget')).toEqual({ id: 's1' })
    })

    test('finds link by directional label', () => {
      const links = [
        {
          id: 's2',
          linkType: { name: 'Depend', sourceToTarget: 'is required for', targetToSource: 'depends on' },
        },
      ]
      expect(findIssueLink(links, 'depends on', 'targetToSource')).toEqual({ id: 's2' })
    })

    test('matches case-insensitively and trims whitespace', () => {
      const links = [{ id: 's3', linkType: { name: 'Relates' } }]
      expect(findIssueLink(links, '  RELATES  ', 'sourceToTarget')).toEqual({ id: 's3' })
    })

    test('returns undefined when no link matches', () => {
      const links = [{ id: 's1', linkType: { name: 'relates' } }]
      expect(findIssueLink(links, 'blocks', 'sourceToTarget')).toBeUndefined()
    })

    test('returns undefined for non-array links', () => {
      expect(findIssueLink('not-an-array', 'relates', 'sourceToTarget')).toBeUndefined()
      expect(findIssueLink(null, 'relates', 'sourceToTarget')).toBeUndefined()
      expect(findIssueLink(undefined, 'relates', 'sourceToTarget')).toBeUndefined()
    })

    test('skips a matching link without a string id', () => {
      const links = [{ linkType: { name: 'relates' } }, { id: 's4', linkType: { name: 'relates' } }]
      expect(findIssueLink(links, 'relates', 'sourceToTarget')).toEqual({ id: 's4' })
    })

    test('empty linkType string never matches', () => {
      expect(linkMatches({ id: 's1', linkType: { name: '' } }, '', 'sourceToTarget')).toBe(false)
    })

    test('linkMatches returns false for non-record link', () => {
      expect(linkMatches(null, 'relates', 'sourceToTarget')).toBe(false)
      expect(linkMatches('str', 'relates', 'sourceToTarget')).toBe(false)
    })

    test('linkMatches returns false when linkType is not a record', () => {
      expect(linkMatches({ id: 's1', linkType: 'relates' }, 'relates', 'sourceToTarget')).toBe(false)
      expect(linkMatches({ id: 's1' }, 'relates', 'sourceToTarget')).toBe(false)
    })
  })
})
