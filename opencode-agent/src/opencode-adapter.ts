// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { createServer } from 'node:net'

import { createOpencodeClient, createOpencodeServer } from '@opencode-ai/sdk'
import { z } from 'zod'

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

/**
 * The SDK client's response envelope.
 *
 * Exported because these decoders *are* the contract with the SDK, and they sit
 * on the one path a `connect` seam cannot reach — which is exactly how they came
 * to be untested guesses in the first place.
 *
 * This is not a guess. The generated client returns
 * `RequestResult<…, ThrowOnError = false, ResponseStyle = "fields">`, i.e.
 * `{ data, error, request, response }` — it does not throw on a non-2xx, it
 * reports through `error`. Verified against a live `opencode serve`: a created
 * session answers `{ data: { id: "ses_…" }, request, response }` with `error`
 * undefined, and a prompt answers `{ data: { parts: [...] }, … }`.
 *
 * Decoding through a schema rather than probing for whichever field happens to
 * exist means an SDK upgrade that moves the payload fails here, naming the
 * contract, instead of yielding empty text that surfaces three layers away as
 * "the model returned no JSON".
 */
const sessionResponseSchema = z.object({
  data: z.object({ id: z.string().min(1) }).optional(),
  error: z.unknown().optional(),
})

const promptResponseSchema = z.object({
  data: z.object({ parts: z.array(z.unknown()).default([]) }).optional(),
  error: z.unknown().optional(),
})

const rejectEnvelopeError = (error: unknown, action: string): void => {
  if (error === undefined || error === null) return
  throw openCodeError(`OpenCode rejected the ${action}: ${JSON.stringify(error)}`)
}

export const decodeReply = (reply: unknown): string => {
  const parsed = promptResponseSchema.safeParse(reply)
  if (!parsed.success) {
    throw openCodeError(`Unexpected prompt response from the OpenCode SDK: ${parsed.error.message}`)
  }

  rejectEnvelopeError(parsed.data.error, 'prompt')
  if (parsed.data.data === undefined) throw openCodeError('OpenCode returned a prompt response with no data')

  // A reply carries step-start / text / step-finish parts; only text is content.
  return collectText(parsed.data.data.parts)
}

export const decodeSessionId = (created: unknown): string => {
  const parsed = sessionResponseSchema.safeParse(created)
  if (!parsed.success) {
    throw openCodeError(`Unexpected session response from the OpenCode SDK: ${parsed.error.message}`)
  }

  rejectEnvelopeError(parsed.data.error, 'session creation')
  if (parsed.data.data === undefined) throw openCodeError('OpenCode returned a session response with no id')

  return parsed.data.data.id
}

const buildBody = (model: ModelRef, request: AgentPromptRequest): SdkPromptBody => ({
  model,
  parts: [{ type: 'text', text: request.prompt }],
  ...(request.agent === undefined ? {} : { agent: request.agent }),
  ...(request.system === undefined ? {} : { system: request.system }),
  ...(request.tools === undefined ? {} : { tools: request.tools }),
})

/**
 * Reserves a free TCP port.
 *
 * `createOpencodeServer` passes its `port` straight to `opencode serve`, and
 * port `0` there does *not* mean "pick an ephemeral one" — the server was
 * observed booting on its 4096 default instead, so two agent processes on one
 * host would collide. Binding a listener and reading back the assigned port
 * gets a real free one. The window between closing this and the server binding
 * is a race in theory; in practice it beats a fixed port that is guaranteed to
 * clash.
 */
const reservePort = (): Promise<number> => {
  const probe = createServer()
  return new Promise((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address !== null ? address.port : 0
      probe.close(() => {
        if (port === 0) reject(new Error('Could not reserve a port for the OpenCode server'))
        else resolve(port)
      })
    })
  })
}

/** The SDK's own default is 5s, which a cold runner with a large repo can miss. */
const SERVER_BOOT_TIMEOUT_MS = 60_000

const connectSdk = async (directory: string, openai: OpenAiSettings): Promise<OpenCodeConnection> => {
  // The provider, endpoint and model are pinned in the server's own config, so
  // the session cannot fall back to whatever credentials happen to be in env.
  // The SDK delivers this to `opencode serve` through OPENCODE_CONFIG_CONTENT —
  // the same channel the review-loop subprocesses use.
  const server = await createOpencodeServer({
    hostname: '127.0.0.1',
    port: await reservePort(),
    config: buildOpencodeConfig(openai),
    timeout: SERVER_BOOT_TIMEOUT_MS,
  })
  const client = createOpencodeClient({ baseUrl: server.url, directory })

  return {
    createSession: async (title) => {
      const created = await client.session.create({ body: { title }, query: { directory } })
      return decodeSessionId(created)
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
      return { text: decodeReply(reply), sessionId }
    },
    close: (): Promise<void> => connection.close(),
  }
}
