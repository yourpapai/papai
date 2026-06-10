// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { RESULT_STORE_MAX_ENTRIES, RESULT_STORE_TTL_MS } from './constants.js'

interface Entry {
  raw: string
  createdAt: number
}

export type ResultPage = { found: false } | { found: true; chunk: string; nextOffset: number; done: boolean }

const store = new Map<string, Map<string, Entry>>()
let counter = 0
let clock: () => number = () => Date.now()

export function setResultStoreClockForTesting(fn: () => number): void {
  clock = fn
}

export function clearResultStoreForTesting(): void {
  store.clear()
  counter = 0
}

function contextMap(contextId: string): Map<string, Entry> {
  let m = store.get(contextId)
  if (m === undefined) {
    m = new Map()
    store.set(contextId, m)
  }
  return m
}

export function putResult(contextId: string, raw: string): string {
  const m = contextMap(contextId)
  counter += 1
  const handle = `res_${counter.toString(16)}`
  m.set(handle, { raw, createdAt: clock() })
  while (m.size > RESULT_STORE_MAX_ENTRIES) {
    const oldest = m.keys().next().value
    if (oldest === undefined) break
    m.delete(oldest)
  }
  return handle
}

export function getResultPage(contextId: string, handle: string, offset: number, limit: number): ResultPage {
  const m = store.get(contextId)
  const entry = m?.get(handle)
  if (m === undefined || entry === undefined) return { found: false }
  if (clock() - entry.createdAt > RESULT_STORE_TTL_MS) {
    m.delete(handle)
    if (m.size === 0) store.delete(contextId)
    return { found: false }
  }
  const start = Math.max(0, offset)
  const chunk = entry.raw.slice(start, start + Math.max(0, limit))
  const nextOffset = start + chunk.length
  return { found: true, chunk, nextOffset, done: nextOffset >= entry.raw.length }
}
