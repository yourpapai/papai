// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { getSessionSnapshots } from '../../src/cache-snapshots.js'
import { userCachesForTesting } from '../../src/cache.js'
import { emitGlobal, emitUser } from '../../src/debug/event-bus.js'
import {
  addClient,
  isOwnLogEntry,
  ownTurnIdsForAdmin,
  pendingTraces,
  recentLlm,
  resetClientsForTest,
  resetTurnBuffers,
} from '../../src/debug/state-collector.js'
import { setupTestDb } from '../utils/test-helpers.js'

type SseEvent = { type: string; data: Record<string, unknown> }

const PASS_ALL = { include: [], exclude: [], level: 0 }

const collect = (): { controller: ReadableStreamDefaultController; seen: string[] } => {
  const seen: string[] = []
  const controller: ReadableStreamDefaultController = {
    enqueue: (chunk: Uint8Array): void => void seen.push(new TextDecoder().decode(chunk)),
    close: (): void => {},
    error: (): void => {},
    desiredSize: 1,
  }
  return { controller, seen }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseFrame(block: string): SseEvent | null {
  const dataLine = block.split('\n').find((l) => l.startsWith('data: '))
  if (dataLine === undefined) return null
  const parsed: unknown = JSON.parse(dataLine.slice('data: '.length))
  if (!isRecord(parsed)) return null
  const type = parsed['type']
  const data = parsed['data']
  if (typeof type !== 'string' || !isRecord(data)) return null
  return { type, data }
}

const parseFrames = (seen: string[]): SseEvent[] =>
  seen
    .join('')
    .split('\n\n')
    .filter((block) => block.startsWith('event: '))
    .map(parseFrame)
    .filter((f): f is SseEvent => f !== null)

const framesOfType = (seen: string[], type: string): SseEvent[] => parseFrames(seen).filter((f) => f.type === type)

const strOf = (value: unknown): string => (typeof value === 'string' ? value : '')

const optStrOf = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

const fieldOf = (item: unknown, key: string): unknown => (isRecord(item) ? item[key] : undefined)

const turnIdsOf = (value: unknown): string[] => {
  const out: string[] = []
  for (const item of Array.isArray(value) ? value : []) out.push(strOf(fieldOf(item, 'turnId')))
  return out
}

const notificationTypesOf = (value: unknown): string[] => {
  const out: string[] = []
  for (const item of Array.isArray(value) ? value : []) out.push(strOf(fieldOf(item, 'type')))
  return out
}

const toolFailureUserIdsOf = (value: unknown): string[] => {
  const out: string[] = []
  for (const item of Array.isArray(value) ? value : []) out.push(strOf(fieldOf(fieldOf(item, 'scope'), 'userId')))
  return out
}

const generatedTextForChatUser = (value: unknown, chatUserId: string): string | undefined => {
  for (const item of Array.isArray(value) ? value : []) {
    if (isRecord(item) && strOf(item['chatUserId']) === chatUserId) return optStrOf(item['generatedText'])
  }
  return undefined
}

beforeEach(async () => {
  await setupTestDb()
  resetClientsForTest()
  resetTurnBuffers()
  recentLlm.length = 0
  pendingTraces.clear()
  userCachesForTesting.clear()
})

afterEach(() => {
  resetClientsForTest()
  userCachesForTesting.clear()
})

describe('log:entry egress attribution', () => {
  test('own entries pass verbatim; foreign and unattributable entries are shaped', () => {
    const { controller, seen } = collect()
    addClient(controller, PASS_ALL, 'a1')

    emitUser('turn:start', 'a1', { turnId: 'turn-own' })
    emitUser('turn:end', 'a1', { turnId: 'turn-own', status: 'ok' })

    emitGlobal('log:entry', { level: 30, time: 't1', msg: 'explicit own', chatUserId: 'a1', userText: 'own-secret' })
    emitGlobal('log:entry', {
      level: 30,
      time: 't2',
      msg: 'explicit foreign',
      chatUserId: 'a2',
      userText: 'foreign-secret',
    })
    emitGlobal('log:entry', { level: 30, time: 't3', msg: 'turn own', turnId: 'turn-own', userText: 'turn-secret' })
    emitGlobal('log:entry', { level: 30, time: 't4', msg: 'unknown turn', turnId: 'turn-nope', userText: 'x' })
    emitGlobal('log:entry', { level: 30, time: 't5', msg: 'unattributable', userText: 'y', durationMs: 3 })

    const byMsg = new Map(framesOfType(seen, 'log:entry').map((f) => [strOf(f.data['msg']), f.data]))
    expect(optStrOf(byMsg.get('explicit own')!['userText'])).toBe('own-secret')
    expect(optStrOf(byMsg.get('explicit foreign')!['userText'])).toBeUndefined()
    expect(strOf(byMsg.get('explicit foreign')!['msg'])).toBe('explicit foreign')
    expect(optStrOf(byMsg.get('explicit foreign')!['chatUserId'])).toBeUndefined()
    expect(optStrOf(byMsg.get('turn own')!['userText'])).toBe('turn-secret')
    expect(optStrOf(byMsg.get('unknown turn')!['userText'])).toBeUndefined()
    expect(optStrOf(byMsg.get('unattributable')!['userText'])).toBeUndefined()
    expect(byMsg.get('unattributable')!['durationMs']).toBe(3)
  })

  test('connection q filter runs after shaping', () => {
    const { controller, seen } = collect()
    addClient(controller, { ...PASS_ALL, q: 'needle' }, 'a1')

    emitGlobal('log:entry', { level: 30, time: 't1', msg: 'noise here', userText: 'needle' })
    emitGlobal('log:entry', { level: 30, time: 't2', msg: 'needle found' })
    emitGlobal('log:entry', { level: 30, time: 't3', msg: 'other', chatUserId: 'a1', userText: 'needle' })

    const msgs = framesOfType(seen, 'log:entry').map((f) => strOf(f.data['msg']))
    expect(msgs).toEqual(['needle found', 'other'])
  })
})

describe('own-turn attribution index', () => {
  test('ownTurnIdsForAdmin collects visible turn ids once; isOwnLogEntry consults the set', () => {
    const { controller } = collect()
    addClient(controller, PASS_ALL)

    emitUser('turn:start', 'a1', { turnId: 't-inflight-own' })
    emitUser('turn:start', 'a2', { turnId: 't-inflight-foreign' })
    emitUser('turn:start', 'a1', { turnId: 't-recent-own' })
    emitUser('turn:end', 'a1', { turnId: 't-recent-own', status: 'ok' })

    const own = ownTurnIdsForAdmin('a1')
    expect(own.has('t-inflight-own')).toBe(true)
    expect(own.has('t-recent-own')).toBe(true)
    expect(own.has('t-inflight-foreign')).toBe(false)
    expect(ownTurnIdsForAdmin(undefined).size).toBe(0)

    expect(isOwnLogEntry({ level: 30, time: 't1', msg: 'm', turnId: 't-recent-own' }, 'a1', own)).toBe(true)
    expect(isOwnLogEntry({ level: 30, time: 't2', msg: 'm', turnId: 't-inflight-foreign' }, 'a1', own)).toBe(false)
    expect(isOwnLogEntry({ level: 30, time: 't3', msg: 'm', turnId: 't-unknown' }, 'a1', own)).toBe(false)
  })
})

describe('non-log event visibility per client', () => {
  test('user-scoped events reach only the owning admin; global events reach all', () => {
    const a = collect()
    const b = collect()
    addClient(a.controller, PASS_ALL, 'a1')
    addClient(b.controller, PASS_ALL, 'a2')

    emitUser('notify:ping', 'a1', { v: 1 })
    emitGlobal('scheduler:tick', { running: true })

    expect(framesOfType(a.seen, 'notify:ping')).toHaveLength(1)
    expect(framesOfType(b.seen, 'notify:ping')).toHaveLength(0)
    expect(framesOfType(a.seen, 'scheduler:tick')).toHaveLength(1)
    expect(framesOfType(b.seen, 'scheduler:tick')).toHaveLength(1)
  })
})

describe('llm:full egress shaping', () => {
  test('own trace keeps generatedText; foreign trace is shaped per client', () => {
    const a = collect()
    const b = collect()
    addClient(a.controller, PASS_ALL, 'a1')
    addClient(b.controller, PASS_ALL, 'a2')

    emitUser('llm:end', 'a1', { chatUserId: 'a1', generatedText: 'the answer', steps: 1, totalDuration: 5 })

    const own = framesOfType(a.seen, 'llm:full')[0]
    expect(own).toBeDefined()
    expect(own!.data['generatedText']).toBe('the answer')

    const foreign = framesOfType(b.seen, 'llm:full')[0]
    expect(foreign).toBeDefined()
    expect(foreign!.data['generatedText']).toBeUndefined()
    expect(foreign!.data['steps']).toBe(1)
  })
})

describe('state:init built per session admin', () => {
  test('excludes foreign recent items, shapes foreign recentLlm, keeps shared surfaces', () => {
    const a = collect()
    addClient(a.controller, PASS_ALL, 'a1')

    emitUser('turn:start', 'a2', { turnId: 'turn-a2' })
    emitUser('turn:end', 'a2', { turnId: 'turn-a2', status: 'ok' })
    emitUser('turn:start', 'a1', { turnId: 'turn-a1' })
    emitUser('turn:end', 'a1', { turnId: 'turn-a1', status: 'ok' })
    emitUser('notify:own', 'a2', { n: 1 })
    emitUser('notify:foreign', 'a1', { n: 2 })
    emitUser('tool:failure_classified', 'a2', {
      turnId: 'x',
      toolName: 't',
      durationMs: 1,
      ok: false,
      failureReason: 'r',
    })
    emitUser('tool:failure_classified', 'a1', {
      turnId: 'y',
      toolName: 't',
      durationMs: 1,
      ok: false,
      failureReason: 'r',
    })
    emitUser('llm:end', 'a2', { chatUserId: 'a2', generatedText: 'own answer', steps: 1 })
    emitUser('llm:end', 'a1', { chatUserId: 'a1', generatedText: 'foreign answer', steps: 1 })

    userCachesForTesting.set('a2', {
      history: [],
      summary: null,
      facts: [],
      instructions: null,
      config: new Map(),
      tools: null,
      lastAccessed: 42,
    })

    const b = collect()
    addClient(b.controller, PASS_ALL, 'a2')

    const init = framesOfType(b.seen, 'state:init')[0]
    expect(init).toBeDefined()
    const data = init!.data

    expect(data['sessions']).toEqual(getSessionSnapshots('a2'))
    expect(turnIdsOf(data['recentTurns'])).toEqual(['turn-a2'])
    expect(notificationTypesOf(data['recentNotifications'])).toEqual(['notify:own'])
    expect(toolFailureUserIdsOf(data['recentToolFailures'])).toEqual(['a2'])

    expect(generatedTextForChatUser(data['recentLlm'], 'a2')).toBe('own answer')
    expect(generatedTextForChatUser(data['recentLlm'], 'a1')).toBeUndefined()

    for (const key of ['scheduler', 'pollers', 'messageCache', 'stats']) {
      expect(key in data).toBe(true)
    }
  })
})
