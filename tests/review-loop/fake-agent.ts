#!/usr/bin/env bun
import { readFileSync } from 'node:fs'
import readline from 'node:readline'

import { z } from 'zod'

const PromptReplySchema = z
  .object({
    text: z.string().optional(),
    chunks: z.array(z.string()).optional(),
    interleaveAvailableCommandsUpdate: z.boolean().optional(),
    exitDuringPrompt: z.boolean().optional(),
  })
  .refine((value) => value.text !== undefined || value.chunks !== undefined, {
    message: 'Prompt replies require text or chunks',
  })

const ScenarioSchema = z.object({
  availableCommands: z.array(z.object({ name: z.string(), description: z.string() })),
  promptReplies: z.array(PromptReplySchema),
  emitAvailableCommandsUpdate: z.boolean().optional(),
  availableCommandsUpdateDelayMs: z.number().int().nonnegative().optional(),
  ignoreSigtermOnShutdown: z.boolean().optional(),
})

const scenarioPath = process.env['ACP_SCENARIO_FILE']
if (scenarioPath === undefined) {
  throw new Error('ACP_SCENARIO_FILE is required')
}

const scenario = ScenarioSchema.parse(JSON.parse(readFileSync(scenarioPath, 'utf8')))
let promptIndex = 0

if (scenario.ignoreSigtermOnShutdown === true) {
  process.on('SIGTERM', () => {})
}

function send(message: unknown): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function resolveSessionId(value: unknown): string {
  return typeof value === 'string' ? value : 'sess_fake'
}

function sendAvailableCommandsUpdate(sessionId: string): void {
  if (scenario.emitAvailableCommandsUpdate === false) {
    return
  }

  send({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'available_commands_update',
        availableCommands: scenario.availableCommands,
      },
    },
  })
}

function sendDelayedAvailableCommandsUpdate(sessionId: string): void {
  const delayMs = scenario.availableCommandsUpdateDelayMs ?? 0
  if (delayMs === 0) {
    sendAvailableCommandsUpdate(sessionId)
    return
  }
  setTimeout(() => {
    sendAvailableCommandsUpdate(sessionId)
  }, delayMs)
}

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Number.POSITIVE_INFINITY,
})

const MessageSchema = z.object({
  id: z.number().optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
})

rl.on('line', (line) => {
  const message = MessageSchema.parse(JSON.parse(line))

  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
        },
        authMethods: [],
      },
    })
    return
  }

  if (message.method === 'session/new') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'sess_fake' },
    })
    sendDelayedAvailableCommandsUpdate('sess_fake')
    return
  }

  if (message.method === 'session/load') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: null,
    })
    sendDelayedAvailableCommandsUpdate(resolveSessionId(message.params?.['sessionId']))
    return
  }

  if (message.method === 'session/set_config_option') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        configOptions: [],
      },
    })
    return
  }

  if (message.method === 'session/prompt') {
    const promptReply = scenario.promptReplies[promptIndex] ?? scenario.promptReplies.at(-1) ?? { text: '' }
    promptIndex += 1
    const promptChunks = promptReply.chunks ?? [promptReply.text ?? '']

    for (const [index, chunk] of promptChunks.entries()) {
      if (promptReply.interleaveAvailableCommandsUpdate === true && index === 1) {
        sendAvailableCommandsUpdate(resolveSessionId(message.params?.['sessionId']))
      }

      send({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: resolveSessionId(message.params?.['sessionId']),
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: {
              type: 'text',
              text: chunk,
            },
          },
        },
      })
    }

    if (promptReply.exitDuringPrompt === true) {
      process.exit(1)
    }

    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        stopReason: 'end_turn',
      },
    })
    return
  }

  send({
    jsonrpc: '2.0',
    id: message.id,
    error: {
      code: -32601,
      message: `Method not found: ${message.method}`,
    },
  })
})
