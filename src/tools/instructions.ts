// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { tool } from 'ai'
import type { ToolSet } from 'ai'
import { z } from 'zod'

import { deleteInstruction, listInstructions, saveInstruction } from '../instructions.js'
import { logger } from '../logger.js'

const log = logger.child({ scope: 'tool:instructions' })

export function makeSaveInstructionTool(contextId: string): ToolSet[string] {
  return tool({
    description:
      'Save a persistent behavioral preference. Call this when the user expresses how the bot should always behave.',
    inputSchema: z.object({
      text: z.string().min(1).describe('The instruction as a short, clear statement, e.g. "Always reply in Spanish"'),
    }),
    execute: ({ text }) => {
      log.debug({ contextId }, 'save_instruction tool called')
      const result = saveInstruction(contextId, text)
      if (result.status === 'saved') {
        log.info({ contextId, id: result.instruction.id }, 'Instruction saved via tool')
      }
      return result
    },
  })
}

export function makeListInstructionsTool(contextId: string): ToolSet[string] {
  return tool({
    description: 'List all custom instructions for this context.',
    inputSchema: z.object({}),
    execute: () => {
      log.debug({ contextId }, 'list_instructions tool called')
      const rawInstructions = listInstructions(contextId)
      const instructions = rawInstructions.map(({ id, text }) => ({ id, text }))
      log.info({ contextId, count: instructions.length }, 'Instructions listed via tool')
      return { instructions }
    },
  })
}

export function makeDeleteInstructionTool(contextId: string): ToolSet[string] {
  return tool({
    description: 'Delete a custom instruction by ID. Call list_instructions first to find the ID.',
    inputSchema: z.object({
      id: z.string().describe('The instruction ID to delete'),
    }),
    execute: ({ id }) => {
      log.debug({ contextId, id }, 'delete_instruction tool called')
      const result = deleteInstruction(contextId, id)
      log.info({ contextId, id, status: result.status }, 'delete_instruction completed')
      return result
    },
  })
}
