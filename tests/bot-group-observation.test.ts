import { beforeEach, describe, expect, test } from 'bun:test'

import { recordGroupObservation } from '../src/bot-group-observation.js'
import { createDmMessage, createMockChat, mockLogger } from './utils/test-helpers.js'

describe('bot-group-observation', () => {
  beforeEach(() => {
    mockLogger()
  })

  test('skips non-group messages', () => {
    const chat = createMockChat()
    const msg = createDmMessage('u1', 'hello')
    expect(() => recordGroupObservation(chat, msg)).not.toThrow()
  })
})
