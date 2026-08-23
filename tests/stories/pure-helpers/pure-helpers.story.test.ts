// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { expect } from 'bun:test'

import type { ModelMessage } from 'ai'

import packageJson from '../../../package.json' with { type: 'json' }
import { announceNewVersion, type AnnouncementsDeps } from '../../../src/announcements.js'
import { readChangelogFile } from '../../../src/changelog-reader.js'
import type { DeferredDeliveryTarget } from '../../../src/chat/types.js'
import { isValidToolSequence, normalizeToolPairs, resolveTrimmedIndices } from '../../../src/memory-tool-pairing.js'
import { trackSchedulerExecution } from '../../../src/utils/scheduler.executions.js'
import { createMockChat } from '../../utils/test-helpers.js'
import { scenario } from '../harness/scenario.js'

const VERSION = packageJson.version

const user = (content: string): ModelMessage => ({ role: 'user', content })
const call = (toolCallId: string): ModelMessage => ({
  role: 'assistant',
  content: [{ type: 'tool-call', toolCallId, toolName: 'get_task', input: {} }],
})
const result = (toolCallId: string): ModelMessage => ({
  role: 'tool',
  content: [{ type: 'tool-result', toolCallId, toolName: 'get_task', output: { type: 'json', value: {} } }],
})

scenario('SCN-memory-tool-pairing: retained history keeps tool exchanges whole', () => {
  const history = [user('before'), call('a'), result('a'), call('b'), result('b'), user('after')]
  const selected = resolveTrimmedIndices(history, [2, 3, 5], 1, 3)
  const retained = selected.map((index) => history[index]!)

  expect(selected).toEqual([3, 4, 5])
  expect(retained[0]?.role).not.toBe('tool')
  expect(isValidToolSequence(retained)).toBe(true)
  expect(normalizeToolPairs(history, [2, 5], 10)).toEqual([1, 2, 5])

  const malformed = [result('orphan'), user('plain'), call('truncated')]
  expect(normalizeToolPairs(malformed, [0, 1, 2], 10)).toEqual([1])
})

scenario('SCN-scheduler-execution-tracking: active execution tracking clears fulfilled and rejected work', async () => {
  const active = new Set<Promise<void>>()
  const fulfilled = Promise.withResolvers<undefined>()
  const trackedFulfilled = trackSchedulerExecution(fulfilled.promise, active)
  expect(trackedFulfilled).toBe(fulfilled.promise)
  expect(active.has(fulfilled.promise)).toBe(true)
  fulfilled.resolve(undefined)
  await trackedFulfilled
  expect(active.has(fulfilled.promise)).toBe(false)

  const rejected = Promise.withResolvers<undefined>()
  const trackedRejected = trackSchedulerExecution(rejected.promise, active)
  rejected.reject(new Error('expected rejection'))
  await expect(trackedRejected).rejects.toThrow('expected rejection')
  expect(active.has(rejected.promise)).toBe(false)
})

scenario('SCN-changelog-version-section: version lookup returns only the requested changelog section', async () => {
  const baseDeps: AnnouncementsDeps = {
    readChangelogFile: () => Promise.resolve(''),
    humanizeChangelog: (raw) => Promise.resolve({ en: raw }),
    persistDraft: () => {},
    updateHumanizedBodies: () => {},
    isVersionAnnounced: () => false,
  }

  const sent: string[] = []
  const chat = createMockChat({
    sendMessage: (_pid: string, _target: DeferredDeliveryTarget, md: string): Promise<void> => {
      sent.push(md)
      return Promise.resolve()
    },
  })
  const reads: URL[] = []
  const reader = (): Promise<string> =>
    readChangelogFile((url) => {
      reads.push(url)
      return Promise.resolve(`## [${VERSION}]\nnew\n\n## [0.0.1]\nold`)
    })
  const persistCalls: number[] = []
  await announceNewVersion(chat, 'platform', 'admin', {
    ...baseDeps,
    readChangelogFile: reader,
    persistDraft: () => {
      persistCalls.push(1)
    },
  })
  expect(reads).toHaveLength(1)
  expect(persistCalls).toHaveLength(1)
  expect(sent).toHaveLength(1)
  expect(sent[0]).toContain('new')
  expect(sent[0]).not.toContain('old')

  const unmatchedPersist: number[] = []
  const unmatchedSent: string[] = []
  const unmatchedChat = createMockChat({
    sendMessage: (_pid: string, _target: DeferredDeliveryTarget, md: string): Promise<void> => {
      unmatchedSent.push(md)
      return Promise.resolve()
    },
  })
  const unmatchedReader = (): Promise<string> => readChangelogFile(() => Promise.resolve('## [0.0.1]\nold'))
  await announceNewVersion(unmatchedChat, 'platform', 'admin', {
    ...baseDeps,
    readChangelogFile: unmatchedReader,
    persistDraft: () => {
      unmatchedPersist.push(1)
    },
  })
  expect(unmatchedPersist).toHaveLength(0)
  expect(unmatchedSent).toHaveLength(0)
})
