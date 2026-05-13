/**
 * Global mock reset preload.
 *
 * Captures real exports of all commonly-mocked modules at startup (before any
 * test file can mock them), then restores originals in a global beforeEach.
 * Individual test files override in their own describe-level beforeEach.
 *
 * Order per test:
 *   global beforeEach (restore originals) -> file beforeEach (apply mocks) -> test -> global afterEach (restore spies)
 */

import { afterEach, beforeEach, mock } from 'bun:test'

import * as _openaiCompat from '@ai-sdk/openai-compatible'
import * as _ai from 'ai'

// Capture real module exports BEFORE any test file loads.
// Spread into plain objects to snapshot current values.
import { _createInMemoryBlobStore, _setBlobStore } from '../src/attachments/blob-store.js'
import * as _interactionRouter from '../src/chat/interaction-router.js'
import { _resetDrizzleDb } from '../src/db/drizzle.js'
import * as _logger from '../src/logger.js'
import * as _messageCache from '../src/message-cache/cache.js'
import * as _provision from '../src/providers/kaneo/provision.js'

const originals: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
  ['../src/logger.js', { ..._logger }],
  ['../src/message-cache/cache.js', { ..._messageCache }],
  ['../src/providers/kaneo/provision.js', { ..._provision }],
  ['../src/chat/interaction-router.js', { ..._interactionRouter }],
  ['ai', { ..._ai }],
  ['@ai-sdk/openai-compatible', { ..._openaiCompat }],
]

beforeEach(() => {
  _resetDrizzleDb()
  _setBlobStore(_createInMemoryBlobStore())
  process.env['S3_BUCKET'] = 'test-bucket'
  process.env['S3_ACCESS_KEY_ID'] = 'test-key'
  process.env['S3_SECRET_ACCESS_KEY'] = 'test-secret'
  for (const [path, exports] of originals) {
    void mock.module(path, () => ({ ...exports }))
  }
})

afterEach(() => {
  mock.restore()
  delete process.env['S3_BUCKET']
  delete process.env['S3_ACCESS_KEY_ID']
  delete process.env['S3_SECRET_ACCESS_KEY']
})
