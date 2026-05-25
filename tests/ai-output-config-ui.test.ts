// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { beforeEach, describe, expect, test } from 'bun:test'

import {
  buildAiOutputConfigSection,
  handleAiOutputConfigCallback,
  parseAiOutputCallbackData,
  serializeAiOutputCallbackData,
} from '../src/ai-output-config-ui.js'
import { getAiOutputSettings } from '../src/ai-output-settings.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

describe('ai-output-config-ui', () => {
  beforeEach(async () => {
    mockLogger()
    await setupTestDb()
  })

  test('renders defaults with toggle buttons', () => {
    const section = buildAiOutputConfigSection('ctx-default')

    expect(section.lines.join('\n')).toContain('AI Output')
    expect(section.lines.join('\n')).toContain('Tool calls: off')
    expect(section.lines.join('\n')).toContain('Reasoning: off')
    expect(section.lines.join('\n')).toContain('Detail level: sanitized')
    expect(section.buttons.map((button) => button.text)).toEqual([
      'Show tool calls',
      'Show reasoning',
      'Use raw detail',
    ])
  })

  test('serializes and parses target context callback data', () => {
    const data = serializeAiOutputCallbackData('detailLevel', 'raw', 'group-9:thread-1')

    expect(data).toBe(`cfg:ai:detailLevel:raw@${Buffer.from('group-9:thread-1').toString('base64url')}`)
    expect(parseAiOutputCallbackData(data)).toEqual({
      setting: 'detailLevel',
      value: 'raw',
      targetContextId: 'group-9:thread-1',
    })
  })

  test('rejects invalid and non-ai callback data', () => {
    expect(parseAiOutputCallbackData('cfg:edit:timezone')).toBeNull()
    expect(parseAiOutputCallbackData('cfg:ai:unknown:on')).toBeNull()
    expect(parseAiOutputCallbackData('cfg:ai:toolVisibility:raw')).toBeNull()
    expect(parseAiOutputCallbackData('cfg:ai:detailLevel:on')).toBeNull()
  })

  test('rejects malformed encoded target callback data', () => {
    expect(parseAiOutputCallbackData('cfg:ai:toolVisibility:on@!!!')).toBeNull()
    expect(parseAiOutputCallbackData('cfg:ai:toolVisibility:on@')).toBeNull()
  })

  test('callback writes target context and returns refreshed section', () => {
    const section = handleAiOutputConfigCallback('ctx-write', 'toolVisibility', 'on')

    expect(getAiOutputSettings('ctx-write').toolVisibility).toBe('on')
    expect(section.lines.join('\n')).toContain('Tool calls: on')
    expect(section.buttons.map((button) => button.text)).toContain('Hide tool calls')
  })
})
