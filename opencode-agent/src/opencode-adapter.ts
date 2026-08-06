// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'

import { openCodeError } from './errors.js'
import { buildOpencodeConfig, modelRef } from './openai-config.js'
import type { OpenAiSettings } from './openai-config.js'
import { errorMessage } from './types.js'

/** `providerID/modelID`, e.g. `openai/gpt-5`. */
export interface ModelRef {
  providerID: string
  modelID: string
}

/**
 * Splits `provider/model` into the shape the SDK expects. Model ids may contain
 * slashes themselves (`openrouter/anthropic/claude-3.5`), so only the first
 * segment is treated as the provider.
 */
export const parseModelRef = (raw: string): ModelRef => {
  const separator = raw.indexOf('/')
  if (separator <= 0 || separator === raw.length - 1) {
    throw openCodeError(`Model must be "provider/model", got "${raw}"`)
  }
  return { providerID: raw.slice(0, separator), modelID: raw.slice(separator + 1) }
}

interface TextLike {
  type?: string
  text?: string
}

/** Concatenates the text parts of an assistant reply, ignoring tool/file parts. */
export const collectText = (parts: readonly unknown[] | undefined): string => {
  if (parts === undefined) return ''

  const chunks: string[] = []
  for (const part of parts) {
    if (typeof part !== 'object' || part === null) continue
    const candidate = part as TextLike
    if (candidate.type !== 'text') continue
    if (typeof candidate.text === 'string' && candidate.text.length > 0) chunks.push(candidate.text)
  }

  return chunks.join('\n').trim()
}

export interface AgentPromptRequest {
  prompt: string
  system?: string
  /** OpenCode agent profile (`build`, `plan`, …). */
  agent?: string
  /** Per-call tool allow/deny overrides passed straight through to the SDK. */
  tools?: Record<string, boolean>
}

export interface AgentPromptResult {
  text: string
  sessionId: string
}

/** A live OpenCode session bound to one workspace directory. */
export interface OpenCodeAgent {
  readonly sessionId: string
  prompt(request: AgentPromptRequest): Promise<AgentPromptResult>
  close(): Promise<void>
}

export interface SdkPromptBody {
  model: ModelRef
  agent?: string
  system?: string
  tools?: Record<string, boolean>
  parts: Array<{ type: 'text'; text: string }>
}

/** Minimal slice of the SDK surface the adapter drives. */
export interface OpenCodeConnection {
  createSession(title: string): Promise<string>
  sendPrompt(sessionId: string, body: SdkPromptBody): Promise<unknown>
  close(): Promise<void>
}

export interface OpenCodeAgentOptions {
  directory: string
  /** The single OpenAI-compatible endpoint this pipeline talks to. */
  openai: OpenAiSettings
  sessionTitle: string
  /** Injection seam for tests. Defaults to the real SDK server + client. */
  connect?: () => Promise<OpenCodeConnection>
}

interface ReplyLike {
  parts?: unknown[]
  data?: { parts?: unknown[] }
  error?: unknown
}

const readReplyText = (reply: unknown): string => {
  if (typeof reply !== 'object' || reply === null) return ''
  const candidate = reply as ReplyLike

  if (candidate.error !== undefined && candidate.error !== null) {
    throw openCodeError(`OpenCode returned an error: ${JSON.stringify(candidate.error)}`)
  }

  const nested = candidate.data === undefined ? undefined : candidate.data.parts
  return collectText(candidate.parts ?? nested)
}

const buildBody = (model: ModelRef, request: AgentPromptRequest): SdkPromptBody => ({
  model,
  parts: [{ type: 'text', text: request.prompt }],
  ...(request.agent === undefined ? {} : { agent: request.agent }),
  ...(request.system === undefined ? {} : { system: request.system }),
  ...(request.tools === undefined ? {} : { tools: request.tools }),
})

interface SessionLike {
  id?: string
  data?: { id?: string }
}

const readSessionId = (created: unknown): string | null => {
  if (typeof created !== 'object' || created === null) return null
  const candidate = created as SessionLike
  if (typeof candidate.id === 'string') return candidate.id
  if (candidate.data !== undefined && typeof candidate.data.id === 'string') return candidate.data.id
  return null
}

const connectSdk = async (directory: string, openai: OpenAiSettings): Promise<OpenCodeConnection> => {
  // The provider, endpoint and model are pinned in the server's own config, so
  // the session cannot fall back to whatever credentials happen to be in env.
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port: 0,
    config: buildOpencodeConfig(openai),
  })
  const client = createOpencodeClient({ baseUrl: server.url, directory })

  return {
    createSession: async (title) => {
      const created = await client.session.create({ body: { title }, query: { directory } })
      const id = readSessionId(created)
      if (id === null) throw openCodeError('OpenCode did not return a session id')
      return id
    },
    sendPrompt: (sessionId, body) => client.session.prompt({ path: { id: sessionId }, body, query: { directory } }),
    close: (): Promise<void> => {
      server.close()
      return Promise.resolve()
    },
  }
}

/**
 * Boots a headless OpenCode server in-process and opens one session against the
 * checked-out workspace. The server binds loopback only and dies with the job,
 * which is exactly the lifetime an ephemeral Actions runner gives us.
 */
export const createOpenCodeAgent = async (options: OpenCodeAgentOptions): Promise<OpenCodeAgent> => {
  const model = parseModelRef(modelRef(options.openai))
  const connect = options.connect ?? ((): Promise<OpenCodeConnection> => connectSdk(options.directory, options.openai))
  const connection = await connect()

  let sessionId: string
  try {
    sessionId = await connection.createSession(options.sessionTitle)
  } catch (error) {
    await connection.close()
    throw openCodeError(`Failed to open OpenCode session: ${errorMessage(error)}`)
  }

  return {
    sessionId,
    prompt: async (request) => {
      const reply = await connection.sendPrompt(sessionId, buildBody(model, request))
      return { text: readReplyText(reply), sessionId }
    },
    close: (): Promise<void> => connection.close(),
  }
}
