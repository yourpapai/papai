// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type * as acp from '@agentclientprotocol/sdk'

import type { AcpProcessClient } from './acp-process-client.js'

export interface AgentPromptReply {
  text: string
  stopReason: string
}

export interface BootstrappedAgentSession {
  sessionId: string
  availableCommands: string[]
  promptText(text: string): Promise<AgentPromptReply>
}

interface SessionState {
  availableCommands: string[]
  responseChunks: string[]
}

async function applySessionConfig(
  client: AcpProcessClient,
  sessionId: string,
  sessionConfig: Record<string, string>,
): Promise<void> {
  await Promise.all(
    Object.entries(sessionConfig).map(([configId, value]) => client.setConfigOption(sessionId, configId, value)),
  )
}

function setupSessionUpdateListener(client: AcpProcessClient, state: SessionState): void {
  client.onSessionUpdate((params: acp.SessionNotification) => {
    const update = params.update
    if (update.sessionUpdate === 'available_commands_update') {
      state.availableCommands.splice(
        0,
        state.availableCommands.length,
        ...update.availableCommands.map((command) => command.name),
      )
      return
    }
    if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
      state.responseChunks.push(update.content.text)
    }
  })
}

async function createOrLoadSession(
  client: AcpProcessClient,
  cwd: string,
  previousSessionId: string | null,
): Promise<string> {
  if (previousSessionId === null) {
    return (await client.newSession(cwd)).sessionId
  }
  await client.loadSession(previousSessionId, cwd)
  return previousSessionId
}

export async function bootstrapAgentSession(
  client: AcpProcessClient,
  options: {
    cwd: string
    previousSessionId: string | null
    sessionConfig: Record<string, string>
  },
): Promise<BootstrappedAgentSession> {
  await client.initialize()

  const state: SessionState = {
    availableCommands: [],
    responseChunks: [],
  }

  setupSessionUpdateListener(client, state)

  const sessionId = await createOrLoadSession(client, options.cwd, options.previousSessionId)

  await applySessionConfig(client, sessionId, options.sessionConfig)

  await client.waitForSessionUpdates()

  return {
    sessionId,
    availableCommands: state.availableCommands,
    async promptText(text: string): Promise<AgentPromptReply> {
      state.responseChunks = []
      const result = await client.prompt(sessionId, text)
      await client.waitForSessionUpdates()
      return {
        text: state.responseChunks.join(''),
        stopReason: result.stopReason,
      }
    },
  }
}
