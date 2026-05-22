// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { randomUUIDv7 } from 'bun'

import { addCachedInstruction, deleteCachedInstruction, getCachedInstructions } from './cache.js'
import { logger } from './logger.js'

const log = logger.child({ scope: 'instructions' })

const MAX_INSTRUCTIONS = 20
const MAX_INSTRUCTION_LENGTH = 500
const DUPLICATE_THRESHOLD = 0.8

type SaveResult =
  | { status: 'saved'; instruction: { id: string; text: string } }
  | { status: 'duplicate' }
  | { status: 'cap_reached' }
  | { status: 'invalid'; message: string }

type DeleteResult = { status: 'deleted' } | { status: 'not_found' }

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/\W+/u)
      .filter((w) => w.length > 0),
  )
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let intersection = 0
  for (const word of a) {
    if (b.has(word)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 1 : intersection / union
}

function isDuplicate(newText: string, existing: readonly { text: string }[]): boolean {
  const newTokens = tokenize(newText)
  return existing.some((e) => jaccardSimilarity(newTokens, tokenize(e.text)) >= DUPLICATE_THRESHOLD)
}

function normalizeText(text: string): string {
  return text.replace(/\s+/gu, ' ').trim()
}

export function saveInstruction(contextId: string, text: string): SaveResult {
  log.debug({ contextId }, 'saveInstruction called')

  const normalized = normalizeText(text)
  if (normalized.length === 0) {
    log.warn({ contextId }, 'Empty instruction rejected')
    return { status: 'invalid', message: 'Instruction text cannot be empty.' }
  }
  if (normalized.length > MAX_INSTRUCTION_LENGTH) {
    log.warn({ contextId, length: normalized.length }, 'Instruction too long')
    return { status: 'invalid', message: `Instruction text exceeds the ${MAX_INSTRUCTION_LENGTH}-character limit.` }
  }

  const existing = getCachedInstructions(contextId)

  if (existing.length >= MAX_INSTRUCTIONS) {
    log.warn({ contextId, count: existing.length }, 'Instruction cap reached')
    return { status: 'cap_reached' }
  }

  if (isDuplicate(normalized, existing)) {
    log.info({ contextId }, 'Duplicate instruction detected')
    return { status: 'duplicate' }
  }

  const id = randomUUIDv7()
  addCachedInstruction(contextId, { id, text: normalized })
  log.info({ contextId, id }, 'Instruction saved')
  return { status: 'saved', instruction: { id, text: normalized } }
}

export function buildInstructionsBlock(contextId: string): string {
  const items = listInstructions(contextId)
  return items.length === 0 ? '' : `=== Custom instructions ===\n${items.map((i) => `- ${i.text}`).join('\n')}\n\n`
}

export function listInstructions(contextId: string): readonly { id: string; text: string }[] {
  log.debug({ contextId }, 'listInstructions called')
  return getCachedInstructions(contextId)
}

export function deleteInstruction(contextId: string, id: string): DeleteResult {
  log.debug({ contextId, id }, 'deleteInstruction called')
  const existing = getCachedInstructions(contextId)
  const found = existing.some((i) => i.id === id)
  if (!found) {
    log.warn({ contextId, id }, 'Instruction not found for deletion')
    return { status: 'not_found' }
  }
  deleteCachedInstruction(contextId, id)
  log.info({ contextId, id }, 'Instruction deleted')
  return { status: 'deleted' }
}
