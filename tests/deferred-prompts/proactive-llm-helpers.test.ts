import { describe, expect, test } from 'bun:test'

import type { DeferredDeliveryTarget } from '../../src/chat/types.js'
import {
  buildMetadataMessages,
  buildMinimalSystemPrompt,
  getStorageContextId,
  modelIdForLightweight,
  resultTextOrDone,
  timezoneOrUtc,
  toolCallCount,
  wrapPrompt,
} from '../../src/deferred-prompts/proactive-llm-helpers.js'
import type { ExecutionMetadata } from '../../src/deferred-prompts/types.js'

const dmTarget: DeferredDeliveryTarget = {
  contextId: 'user-1',
  contextType: 'dm',
  threadId: null,
  audience: 'personal',
  mentionUserIds: [],
  createdByUserId: 'user-1',
  createdByUsername: null,
}

describe('proactive-llm-helpers', () => {
  test('uses thread-scoped storage context for group threads', () => {
    expect(getStorageContextId({ ...dmTarget, contextId: '-1001', contextType: 'group', threadId: '42' })).toBe(
      '-1001:42',
    )
  })

  test('uses delivery context id when no group thread exists', () => {
    expect(getStorageContextId(dmTarget)).toBe('user-1')
  })

  test('resolves fallback values without fallback expressions at call sites', () => {
    const missingText: string | undefined = undefined
    expect(resultTextOrDone(missingText)).toBe('Done.')
    expect(resultTextOrDone('Ready')).toBe('Ready')
    expect(modelIdForLightweight(null, 'main-model')).toBe('main-model')
    expect(modelIdForLightweight('small-model', 'main-model')).toBe('small-model')
    expect(timezoneOrUtc(null)).toBe('UTC')
    expect(timezoneOrUtc('Europe/Berlin')).toBe('Europe/Berlin')
  })

  test('counts top-level tool calls defensively', () => {
    expect(toolCallCount({ toolCalls: [{ toolName: 'create_task' }] })).toBe(1)
    expect(toolCallCount({ toolCalls: 'not-an-array' })).toBeUndefined()
    expect(toolCallCount(null)).toBeUndefined()
  })

  test('builds minimal prompt and metadata messages', () => {
    const metadata: ExecutionMetadata = {
      mode: 'lightweight',
      delivery_brief: 'Brief',
      context_snapshot: 'Snapshot',
    }

    expect(buildMinimalSystemPrompt('scheduled')).toContain('[PROACTIVE EXECUTION]')
    expect(buildMetadataMessages(metadata)).toEqual([
      { role: 'system', content: '[DELIVERY BRIEF]\nBrief' },
      { role: 'system', content: '[CONTEXT FROM CREATION TIME]\nSnapshot' },
    ])
    expect(wrapPrompt('drink water')).toBe('===DEFERRED_TASK===\ndrink water\n===END_DEFERRED_TASK===')
  })
})
