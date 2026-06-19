// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { describe, expect, test } from 'bun:test'

import type { ProcessMessageRest } from '../src/llm-orchestrator-process-args.js'
import { resolveAttachmentIds, resolveDeps, resolveTurnId } from '../src/llm-orchestrator-process-args.js'
import { defaultDeps } from '../src/llm-orchestrator.js'

describe('llm-orchestrator-process-args', () => {
  describe('resolveDeps', () => {
    test('returns fallback when deps is undefined', () => {
      expect(resolveDeps(undefined, defaultDeps)).toBe(defaultDeps)
    })

    test('returns provided deps when defined (prefers provided over fallback)', () => {
      const sentinel = { ...defaultDeps }
      expect(resolveDeps(sentinel, defaultDeps)).toBe(sentinel)
    })
  })

  describe('resolveAttachmentIds', () => {
    test('returns empty array when undefined', () => {
      expect(resolveAttachmentIds(undefined)).toEqual([])
    })

    test('returns provided ids when defined', () => {
      const ids = ['a', 'b']
      expect(resolveAttachmentIds(ids)).toBe(ids)
    })
  })

  describe('resolveTurnId', () => {
    test('returns a uuid when undefined', () => {
      const id = resolveTurnId(undefined)
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    test('returns the provided id when defined', () => {
      expect(resolveTurnId('my-turn-id')).toBe('my-turn-id')
    })
  })

  describe('ProcessMessageRest actorRole element', () => {
    test('accepts actorRole guest as fifth element', () => {
      // Type-level check: ensure the tuple accepts actorRole at index 4.
      // This is a compile-time assertion; if the type is wrong this file
      // will fail to typecheck.
      const rest: ProcessMessageRest = [undefined, undefined, undefined, undefined, 'guest']
      const [, , , , actorRole] = rest
      expect(actorRole).toBe('guest')
    })

    test('actorRole is undefined when omitted', () => {
      const rest: ProcessMessageRest = []
      const [, , , , actorRole] = rest
      expect(actorRole).toBeUndefined()
    })

    test('actorRole accepts member value', () => {
      const rest: ProcessMessageRest = [undefined, undefined, undefined, undefined, 'member']
      const [, , , , actorRole] = rest
      expect(actorRole).toBe('member')
    })
  })
})
