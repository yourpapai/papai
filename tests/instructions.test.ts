import { describe, test, expect, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { _userCaches } from '../src/cache.js'
import { saveInstruction, listInstructions, deleteInstruction } from '../src/instructions.js'
import { mockLogger, setupTestDb } from './utils/test-helpers.js'

beforeEach(() => {
  mockLogger()
})

describe('saveInstruction', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('stores instruction and returns it', () => {
    const result = saveInstruction('ctx-1', 'Always reply in Spanish')
    assert(result.status === 'saved')
    expect(result.instruction.text).toBe('Always reply in Spanish')
    expect(result.instruction.id).toBeDefined()
  })

  test('normalizes whitespace and trims text', () => {
    const result = saveInstruction('ctx-1', '  Always  reply   in  Spanish  ')
    assert(result.status === 'saved')
    expect(result.instruction.text).toBe('Always reply in Spanish')
  })

  test('collapses newlines and tabs into single spaces', () => {
    const result = saveInstruction('ctx-1', 'Always reply\n\nin\tSpanish')
    assert(result.status === 'saved')
    expect(result.instruction.text).toBe('Always reply in Spanish')
  })

  test('rejects empty string', () => {
    const result = saveInstruction('ctx-1', '')
    expect(result.status).toBe('invalid')
  })

  test('rejects whitespace-only string', () => {
    const result = saveInstruction('ctx-1', '   \n\t  ')
    expect(result.status).toBe('invalid')
  })

  test('rejects text exceeding 500 characters', () => {
    const longText = 'a'.repeat(501)
    const result = saveInstruction('ctx-1', longText)
    expect(result.status).toBe('invalid')
  })

  test('accepts text at exactly 500 characters', () => {
    const text = 'a'.repeat(500)
    const result = saveInstruction('ctx-1', text)
    expect(result.status).toBe('saved')
  })

  test('detects duplicates that differ only by whitespace', () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    const result = saveInstruction('ctx-1', '  Always  reply  in  Spanish  ')
    expect(result.status).toBe('duplicate')
  })

  test('returns duplicate when >80% word overlap with existing', () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    const result = saveInstruction('ctx-1', 'Always reply in spanish language')
    expect(result.status).toBe('duplicate')
  })

  test('returns cap_reached when 20 instructions already stored', () => {
    for (let i = 0; i < 20; i++) {
      saveInstruction('ctx-1', `Unique instruction number ${i} about topic ${i}`)
    }
    const result = saveInstruction('ctx-1', 'One more unique instruction here')
    expect(result.status).toBe('cap_reached')
  })

  test('different contexts are isolated', () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    expect(listInstructions('ctx-2')).toHaveLength(0)
  })
})

describe('listInstructions', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('returns empty array when no instructions', () => {
    expect(listInstructions('ctx-1')).toEqual([])
  })

  test('returns all saved instructions', () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    saveInstruction('ctx-1', 'Use high priority by default')
    const result = listInstructions('ctx-1')
    expect(result).toHaveLength(2)
  })
})

describe('deleteInstruction', () => {
  beforeEach(async () => {
    _userCaches.clear()
    await setupTestDb()
  })

  test('removes instruction by id', () => {
    const r = saveInstruction('ctx-1', 'Always reply in Spanish')
    assert(r.status === 'saved')
    deleteInstruction('ctx-1', r.instruction.id)
    expect(listInstructions('ctx-1')).toHaveLength(0)
  })

  test('returns not_found for unknown id', () => {
    const result = deleteInstruction('ctx-1', 'nonexistent-id')
    expect(result.status).toBe('not_found')
  })

  test('returns deleted for known id', () => {
    const r = saveInstruction('ctx-1', 'Always reply in Spanish')
    assert(r.status === 'saved')
    const result = deleteInstruction('ctx-1', r.instruction.id)
    expect(result.status).toBe('deleted')
  })
})
