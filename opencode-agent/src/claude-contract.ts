// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { z } from 'zod'

import { PipelineError } from './errors.js'
import type { Logger } from './logger.js'
import { parseModelRef } from './sdk-contract.js'

/**
 * The contract with the `claude` CLI, as recorded rather than assumed — the
 * `sdk-contract.ts` doctrine carried to the second backend. Split the same way
 * its OpenCode twin is: this file is what the CLI **says** (the NDJSON line
 * schemas) and what it is **asked** (the argv builder), `claude-connect.ts` is
 * how it is started and addressed, and `claude-adapter.ts` is the session the
 * pipeline holds. They change for the same reasons their twins do.
 *
 * The line shapes come from the fixture corpus under
 * `tests/opencode-agent/fixtures/claude-cli/` — its README records the
 * provenance of each file. When the pinned CLI version moves, re-run
 * `bun run opencode-agent:test:claude-live` and re-record rather than
 * adjusting a decoder by inspection.
 */

/**
 * The Linux single-argument cap (`MAX_ARG_STRLEN`), which the user prompt
 * dodges by riding stdin but the appended system prompt cannot — so the builder
 * refuses to compose an invocation that would die in `spawn` with an `E2BIG`
 * the failure classifier would misread as a dead backend.
 */
export const MAX_ARG_STRLEN = 131_072

/** Token usage as the CLI's `result` line reports it. `total` is every bucket summed. */
export interface ClaudeUsage {
  input: number
  output: number
  cacheWrite: number
  cacheRead: number
  total: number
}

/** One decoded NDJSON line, reduced to the scalars the pipeline may consume. */
export type ClaudeStreamLine =
  | { readonly kind: 'init'; readonly sessionId: string }
  | { readonly kind: 'assistant'; readonly tools: readonly string[] }
  | { readonly kind: 'tool-results'; readonly succeeded: number; readonly failed: number }
  | { readonly kind: 'stream-event'; readonly tool: string | null }
  | {
      readonly kind: 'result'
      readonly isError: boolean
      readonly text: string
      readonly sessionId: string
      readonly usage: ClaudeUsage
      readonly costUsd: number
    }

/**
 * The init line: the stream's first line, and the only session-id source.
 *
 * Narrow on purpose — the recorded init line carries a dozen more fields
 * (slash commands, plugins, capabilities), none of which the pipeline reads,
 * so none of which the schema names. A `system` line of another subtype
 * (`compact_boundary`, say) skips, like every unrecognized shape.
 */
const initLineSchema = z.object({
  type: z.literal('system'),
  subtype: z.literal('init'),
  session_id: z.string().min(1),
})

/** A content block reduced to its shape and, for tool calls, its name. */
const blockSchema = z.object({ type: z.string(), name: z.string().optional() })

const assistantLineSchema = z.object({
  type: z.literal('assistant'),
  message: z.object({ content: z.array(blockSchema).optional() }).optional(),
})

/** A tool result block: the completion status of a call, without its content. */
const resultBlockSchema = z.object({ type: z.string(), is_error: z.boolean().optional() })

const userLineSchema = z.object({
  type: z.literal('user'),
  message: z.object({ content: z.array(resultBlockSchema).optional() }).optional(),
})

const streamEventLineSchema = z.object({
  type: z.literal('stream_event'),
  event: z.object({ content_block: blockSchema.optional() }).optional(),
})

const usageSchema = z.object({
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_creation_input_tokens: z.number().default(0),
  cache_read_input_tokens: z.number().default(0),
})

const resultLineSchema = z.object({
  type: z.literal('result'),
  is_error: z.boolean(),
  result: z.string(),
  session_id: z.string().min(1),
  usage: usageSchema,
  total_cost_usd: z.number().default(0),
})

/**
 * Decodes one NDJSON line, or `null` when its shape is not recognized.
 *
 * `null` never fails the turn — the `activity.ts` doctrine: a line the pin
 * does not know is skipped for progress purposes, and only the `result` line's
 * absence or error signalling (which the adapter, not this decoder, judges)
 * ends a turn badly.
 */
export const decodeClaudeLine = (raw: unknown): ClaudeStreamLine | null => {
  const init = initLineSchema.safeParse(raw)
  if (init.success) return { kind: 'init', sessionId: init.data.session_id }

  const assistant = assistantLineSchema.safeParse(raw)
  if (assistant.success) {
    const blocks = assistant.data.message?.content ?? []
    return { kind: 'assistant', tools: blocks.flatMap((block) => (block.name === undefined ? [] : [block.name])) }
  }

  const user = userLineSchema.safeParse(raw)
  if (user.success) {
    const blocks = user.data.message?.content ?? []
    const failed = blocks.filter((block) => block.is_error === true).length
    return { kind: 'tool-results', succeeded: blocks.length - failed, failed }
  }

  const streamEvent = streamEventLineSchema.safeParse(raw)
  if (streamEvent.success) {
    return { kind: 'stream-event', tool: streamEvent.data.event?.content_block?.name ?? null }
  }

  const result = resultLineSchema.safeParse(raw)
  if (!result.success) return null
  const usage = result.data.usage
  return {
    kind: 'result',
    isError: result.data.is_error,
    text: result.data.result,
    sessionId: result.data.session_id,
    usage: {
      input: usage.input_tokens,
      output: usage.output_tokens,
      cacheWrite: usage.cache_creation_input_tokens,
      cacheRead: usage.cache_read_input_tokens,
      total:
        usage.input_tokens + usage.output_tokens + usage.cache_creation_input_tokens + usage.cache_read_input_tokens,
    },
    costUsd: result.data.total_cost_usd,
  }
}

/** Splits a stream into parsed lines, skipping blanks and undecodable JSON. */
export const parseNdjsonStream = (text: string): unknown[] =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown]
      } catch {
        return []
      }
    })

/**
 * The argv half of the contract: what one turn asks the CLI to run.
 *
 * Prompt on **stdin** (a single Linux argument is capped at 128 KiB and `ps`
 * would carry the prompt otherwise), system prompt through
 * `--append-system-prompt` (the CLI's built-in prompt defines its tools'
 * contracts; this pipeline's prompts are additions), and the profile's
 * allowlist through `--allowedTools` with `--permission-mode default` —
 * composition semantics recorded in the fixture corpus's adversarial case: the
 * allowlist auto-approves its members and enables nothing, so an unlisted tool
 * has no grantor under headless `-p` and is refused rather than run.
 */

/** The profile → allowlist mapping, pinned by the spec. No wildcard exists here. */
const ALLOWLISTS = {
  plan: 'Read,Glob,Grep',
  propose: 'Read,Edit,Write,Glob,Grep',
  build: 'Read,Edit,Write,Bash,Glob,Grep',
} as const

export interface ClaudeTurnRequest {
  prompt: string
  system?: string
  /** The profile the invoking phase named (`plan`, `propose`, `build`). */
  agent?: string
  /** The memoized CLI session id; `null` or absent spawns a fresh session. */
  resumeSessionId?: string | null
}

/**
 * The model knobs that cross to this backend as plain values — never the
 * `OpenAiSettings` object, whose gateway half must not reach a claude path.
 */
export interface ClaudeModelKnobs {
  /** The main model id, as `LLM_MODEL` spelled it (a `provider/` prefix is stripped). */
  model: string
  /** `LLM_MODEL_LIGHT`, reaching `plan`-profile turns only. */
  lightModel: string | null
  /** `AGENT_EFFORT_PLAN`, passed through when set. */
  planEffort: string | null
  /** `AGENT_EFFORT_BUILD`, passed through when set. */
  buildEffort: string | null
}

export interface ClaudeInvocation {
  argv: readonly string[]
  /** The prompt, delivered on stdin rather than argv. */
  stdinPrompt: string
}

/** The composed system prompt would not fit one argv entry; said in a way a maintainer can act on. */
export const claudeArgLimitError = (bytes: number, cap: number): PipelineError =>
  new PipelineError(
    'CLAUDE_ARG_LIMIT',
    `The composed system prompt is ${bytes.toLocaleString('en-US')} bytes and the operating system caps one ` +
      `command-line argument at ${cap.toLocaleString('en-US')} bytes (MAX_ARG_STRLEN), so the \`claude\` process ` +
      'could not even start. Shrink the inlined skill set this run loads — the system prompt is the one prompt ' +
      'component no budget caps, and it is what grew.',
  )

/**
 * Only the model id crosses: one `LLM_MODEL` knob serves either backend, and a
 * value spelled `provider/model` (the OpenCode form) keeps its model id here.
 */
const modelIdForCli = (raw: string): string => (raw.includes('/') ? parseModelRef(raw).modelID : raw)

/** Which allowlist, model and effort a profile's turn runs with. */
const profileSelection = (
  agent: string | undefined,
  knobs: ClaudeModelKnobs,
  log: Logger,
): { allowlist: string; model: string; effort: string | null } => {
  if (agent === 'plan') {
    return { allowlist: ALLOWLISTS.plan, model: knobs.lightModel ?? knobs.model, effort: knobs.planEffort }
  }
  if (agent === 'propose') return { allowlist: ALLOWLISTS.propose, model: knobs.model, effort: null }
  if (agent === 'build') return { allowlist: ALLOWLISTS.build, model: knobs.model, effort: knobs.buildEffort }

  // The weaker profile is the default, so an agent this pipeline does not name
  // inherits the restricted set rather than a free pass.
  const named = agent ?? '(no profile named)'
  log.warn({ agent: named }, `Agent profile "${named}" is not one this backend pins; the plan allowlist applies`)
  return { allowlist: ALLOWLISTS.plan, model: knobs.lightModel ?? knobs.model, effort: knobs.planEffort }
}

/**
 * Composes one CLI invocation. Refuses — loudly, and before anything spawns —
 * an appended system prompt that cannot ride one argv entry.
 */
export const buildClaudeArgv = (request: ClaudeTurnRequest, knobs: ClaudeModelKnobs, log: Logger): ClaudeInvocation => {
  const system = request.system
  if (system !== undefined) {
    const bytes = Buffer.byteLength(system, 'utf8')
    if (bytes > MAX_ARG_STRLEN) throw claudeArgLimitError(bytes, MAX_ARG_STRLEN)
  }

  const selection = profileSelection(request.agent, knobs, log)
  const resume = request.resumeSessionId ?? null

  return {
    argv: [
      '--bare',
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'default',
      '--allowedTools',
      selection.allowlist,
      '--model',
      modelIdForCli(selection.model),
      ...(selection.effort === null ? [] : ['--effort', selection.effort]),
      ...(system === undefined ? [] : ['--append-system-prompt', system]),
      ...(resume === null ? [] : ['--resume', resume]),
    ],
    stdinPrompt: request.prompt,
  }
}
