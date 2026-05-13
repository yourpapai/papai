import { describe, test, expect, beforeEach } from 'bun:test'
import assert from 'node:assert/strict'

import { _userCaches } from '../../src/cache.js'
import { saveInstruction } from '../../src/instructions.js'
import {
  makeSaveInstructionTool,
  makeListInstructionsTool,
  makeDeleteInstructionTool,
} from '../../src/tools/instructions.js'
import { mockLogger, setupTestDb } from '../utils/test-helpers.js'

beforeEach(async () => {
  mockLogger()
  _userCaches.clear()
  await setupTestDb()
})

async function exec(
  tool: ReturnType<typeof makeSaveInstructionTool>,
  input: Record<string, unknown>,
): Promise<unknown> {
  if (!tool.execute) throw new Error('Tool execute is undefined')
  const result: unknown = await tool.execute(input, { toolCallId: '1', messages: [] })
  return result
}

describe('save_instruction tool', () => {
  test('returns confirmation on save', async () => {
    const tool = makeSaveInstructionTool('ctx-1')
    const result = await exec(tool, { text: 'Always reply in Spanish' })
    expect(result).toHaveProperty('status', 'saved')
  })

  test('returns duplicate message', async () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    const tool = makeSaveInstructionTool('ctx-1')
    const result = await exec(tool, { text: 'Always reply in spanish language' })
    expect(result).toHaveProperty('status', 'duplicate')
  })

  test('returns cap_reached message', async () => {
    for (let i = 0; i < 20; i++) {
      saveInstruction('ctx-1', `Unique instruction number ${i} about topic ${i}`)
    }
    const tool = makeSaveInstructionTool('ctx-1')
    const result = await exec(tool, { text: 'One more unique instruction here' })
    expect(result).toHaveProperty('status', 'cap_reached')
  })
})

describe('list_instructions tool', () => {
  test('returns empty list', async () => {
    const tool = makeListInstructionsTool('ctx-1')
    const result = await exec(tool, {})
    expect(result).toHaveProperty('instructions', [])
  })

  test('returns stored instructions', async () => {
    saveInstruction('ctx-1', 'Always reply in Spanish')
    const tool = makeListInstructionsTool('ctx-1')
    const result = await exec(tool, {})
    expect(result).toHaveProperty('instructions')
  })
})

describe('delete_instruction tool', () => {
  test('returns deleted confirmation', async () => {
    const r = saveInstruction('ctx-1', 'Always reply in Spanish')
    assert(r.status === 'saved', 'expected saved')
    const tool = makeDeleteInstructionTool('ctx-1')
    const result = await exec(tool, { id: r.instruction.id })
    expect(result).toHaveProperty('status', 'deleted')
  })

  test('returns not_found message', async () => {
    const tool = makeDeleteInstructionTool('ctx-1')
    const result = await exec(tool, { id: 'unknown' })
    expect(result).toHaveProperty('status', 'not_found')
  })
})
