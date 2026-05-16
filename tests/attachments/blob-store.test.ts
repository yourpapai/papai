// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import {
  buildBlobKey,
  _createInMemoryBlobStore,
  getBlobStore,
  isS3Configured,
  _resetBlobStore,
  _setBlobStore,
} from '../../src/attachments/blob-store.js'
import { mockLogger } from '../utils/test-helpers.js'

describe('blob-store DI', () => {
  beforeEach(() => {
    mockLogger()
  })

  afterEach(() => {
    _resetBlobStore()
    delete process.env['S3_PREFIX']
    delete process.env['S3_BUCKET']
    delete process.env['S3_ACCESS_KEY_ID']
    delete process.env['S3_SECRET_ACCESS_KEY']
  })

  test('round-trips bytes through the in-memory store and supports delete', async () => {
    const store = _createInMemoryBlobStore()
    _setBlobStore(store)

    await getBlobStore().put('ctx/key-1', Buffer.from('hello'), 'text/plain')
    expect((await getBlobStore().get('ctx/key-1')).toString('utf8')).toBe('hello')

    await getBlobStore().delete('ctx/key-1')
    await expect(getBlobStore().get('ctx/key-1')).rejects.toThrow()
  })

  test('deleteMany removes a batch of keys at once', async () => {
    const store = _createInMemoryBlobStore()
    _setBlobStore(store)

    await store.put('a', Buffer.from('1'))
    await store.put('b', Buffer.from('2'))
    await store.put('c', Buffer.from('3'))
    expect(store.size()).toBe(3)

    await store.deleteMany(['a', 'b'])

    expect(store.has('a')).toBe(false)
    expect(store.has('b')).toBe(false)
    expect(store.has('c')).toBe(true)
  })

  test('buildBlobKey honours an optional S3_PREFIX', () => {
    delete process.env['S3_PREFIX']
    expect(buildBlobKey('ctx-1', 'att_1')).toBe('ctx-1/att_1')

    process.env['S3_PREFIX'] = 'envname'
    expect(buildBlobKey('ctx-1', 'att_1')).toBe('envname/ctx-1/att_1')

    process.env['S3_PREFIX'] = 'envname/'
    expect(buildBlobKey('ctx-1', 'att_1')).toBe('envname/ctx-1/att_1')
  })

  describe('isS3Configured', () => {
    test('returns false when no S3 env vars are set', () => {
      delete process.env['S3_BUCKET']
      delete process.env['S3_ACCESS_KEY_ID']
      delete process.env['S3_SECRET_ACCESS_KEY']
      expect(isS3Configured()).toBe(false)
    })

    test('returns false when S3_BUCKET is missing', () => {
      delete process.env['S3_BUCKET']
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'
      expect(isS3Configured()).toBe(false)
    })

    test('returns false when S3_ACCESS_KEY_ID is missing', () => {
      process.env['S3_BUCKET'] = 'my-bucket'
      delete process.env['S3_ACCESS_KEY_ID']
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'
      expect(isS3Configured()).toBe(false)
    })

    test('returns false when S3_SECRET_ACCESS_KEY is missing', () => {
      process.env['S3_BUCKET'] = 'my-bucket'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      delete process.env['S3_SECRET_ACCESS_KEY']
      expect(isS3Configured()).toBe(false)
    })

    test('returns false when S3 env vars are empty strings', () => {
      process.env['S3_BUCKET'] = ''
      process.env['S3_ACCESS_KEY_ID'] = ''
      process.env['S3_SECRET_ACCESS_KEY'] = ''
      expect(isS3Configured()).toBe(false)
    })

    test('returns true when all required S3 env vars are set', () => {
      process.env['S3_BUCKET'] = 'my-bucket'
      process.env['S3_ACCESS_KEY_ID'] = 'key'
      process.env['S3_SECRET_ACCESS_KEY'] = 'secret'
      expect(isS3Configured()).toBe(true)
    })
  })
})
