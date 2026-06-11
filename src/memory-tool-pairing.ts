// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { ModelMessage } from 'ai'

import { logger } from './logger.js'

const log = logger.child({ scope: 'memory:tool-pairing' })

type ToolIdSets = { readonly calls: ReadonlySet<string>; readonly results: ReadonlySet<string> }

const messageParts = (content: unknown): readonly unknown[] => (Array.isArray(content) ? content : [])

/** Collect the tool-call ids and tool-result ids referenced by a single message. */
const toolIdsOf = (message: ModelMessage): ToolIdSets => {
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const part of messageParts(message.content)) {
    if (part === null || typeof part !== 'object') continue
    const typed = part as { type?: unknown; toolCallId?: unknown }
    if (typeof typed.toolCallId !== 'string') continue
    if (typed.type === 'tool-call') calls.add(typed.toolCallId)
    else if (typed.type === 'tool-result') results.add(typed.toolCallId)
  }
  return { calls, results }
}

/**
 * A trimmed history is only valid for the chat API when it does not start with a
 * tool-result message and every tool-call has a matching tool-result (and vice versa).
 */
export const isValidToolSequence = (messages: readonly ModelMessage[]): boolean => {
  if (messages.length > 0 && messages[0]!.role === 'tool') return false
  const calls = new Set<string>()
  const results = new Set<string>()
  for (const message of messages) {
    const ids = toolIdsOf(message)
    for (const id of ids.calls) calls.add(id)
    for (const id of ids.results) results.add(id)
  }
  if (calls.size !== results.size) return false
  for (const id of calls) {
    if (!results.has(id)) return false
  }
  return true
}

/** Disjoint-set forest grouping messages that share a tool-call id into atomic exchanges. */
const buildExchangeRoots = (history: readonly ModelMessage[]): readonly number[] => {
  const parent = Array.from({ length: history.length }, (_, i) => i)
  const find = (x: number): number => {
    let root = x
    while (parent[root] !== root) {
      parent[root] = parent[parent[root]!]!
      root = parent[root]!
    }
    return root
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // Keep the lowest index as the root so the assistant call anchors the exchange.
    if (ra < rb) parent[rb] = ra
    else parent[ra] = rb
  }
  const firstIndexForId = new Map<string, number>()
  history.forEach((message, index) => {
    const ids = toolIdsOf(message)
    for (const id of [...ids.calls, ...ids.results]) {
      const prev = firstIndexForId.get(id)
      if (prev === undefined) firstIndexForId.set(id, index)
      else union(prev, index)
    }
  })
  return history.map((_, i) => find(i))
}

type Exchange = { readonly root: number; readonly members: readonly number[]; readonly valid: boolean }

const groupExchanges = (history: readonly ModelMessage[]): readonly Exchange[] => {
  const roots = buildExchangeRoots(history)
  const byRoot = new Map<number, number[]>()
  roots.forEach((root, index) => {
    const bucket = byRoot.get(root) ?? []
    bucket.push(index)
    byRoot.set(root, bucket)
  })
  return Array.from(byRoot.entries())
    .map(([root, members]): Exchange => {
      const calls = new Set<string>()
      const results = new Set<string>()
      for (const index of members) {
        const ids = toolIdsOf(history[index]!)
        for (const id of ids.calls) calls.add(id)
        for (const id of ids.results) results.add(id)
      }
      const valid = calls.size === results.size && [...calls].every((id) => results.has(id))
      return { root, members, valid }
    })
    .toSorted((a, b) => a.root - b.root)
}

const totalMembers = (list: readonly Exchange[]): number => list.reduce((sum, e) => sum + e.members.length, 0)

/**
 * Repair a set of selected indices so the resulting message slice is always a valid
 * tool-call/tool-result sequence: selections expand to whole exchanges, truncated or
 * orphaned exchanges are dropped, and the `trimMax` cap is honoured by dropping whole
 * exchanges oldest-first (never splitting a pair).
 */
export const normalizeToolPairs = (
  history: readonly ModelMessage[],
  selected: readonly number[],
  trimMax: number,
): readonly number[] => {
  const exchanges = groupExchanges(history)
  const rootOf = new Map<number, number>()
  for (const exchange of exchanges) {
    for (const index of exchange.members) rootOf.set(index, exchange.root)
  }
  const selectedRoots = new Set(selected.map((index) => rootOf.get(index)))
  const kept = exchanges.filter((e) => e.valid && selectedRoots.has(e.root))

  // Honour the cap by dropping whole exchanges oldest-first, but never drop the last one.
  let survivors = kept
  while (totalMembers(survivors) > trimMax && survivors.length > 1) {
    survivors = survivors.slice(1)
  }

  return survivors.flatMap((e) => e.members).toSorted((a, b) => a - b)
}

/** Fallback selection: the most recent messages that still form a valid sequence. */
const selectRecentValid = (history: readonly ModelMessage[], trimMax: number): readonly number[] => {
  const start = Math.max(0, history.length - trimMax)
  const window = Array.from({ length: history.length - start }, (_, i) => start + i)
  return normalizeToolPairs(history, window, trimMax)
}

const clampIndices = (
  selected: readonly number[],
  trimMin: number,
  trimMax: number,
  historyLength: number,
): readonly number[] => {
  if (selected.length > trimMax) {
    return selected.slice(selected.length - trimMax)
  }
  if (selected.length < trimMin) {
    const selectedSet = new Set(selected)
    const candidates = Array.from({ length: historyLength }, (_, i) => i)
      .filter((i) => !selectedSet.has(i))
      .toReversed()
    return [...selected, ...candidates.slice(0, trimMin - selected.length)].toSorted((a, b) => a - b)
  }
  return selected
}

/**
 * Turn the memory model's raw `keep_indices` into a final, valid retained-index list:
 * filter out-of-range/duplicate indices, clamp to the [trimMin, trimMax] size band,
 * then enforce tool-call/tool-result pairing integrity (with a recent-valid fallback).
 */
export const resolveTrimmedIndices = (
  history: readonly ModelMessage[],
  keepIndices: readonly number[],
  trimMin: number,
  trimMax: number,
): readonly number[] => {
  const clamped = clampIndices(
    [...new Set(keepIndices)].filter((i) => i >= 0 && i < history.length).toSorted((a, b) => a - b),
    trimMin,
    trimMax,
    history.length,
  )
  const paired = normalizeToolPairs(history, clamped, trimMax)
  if (isValidToolSequence(paired.map((i) => history[i]!))) return paired
  log.warn({ historyLength: history.length }, 'Tool-pairing normalization fell back to recent-valid slice')
  return selectRecentValid(history, trimMax)
}
