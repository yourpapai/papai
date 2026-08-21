// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import type { Config } from '@opencode-ai/sdk'

import { mcpBlock } from './mcp-servers.js'
import type { McpServers } from './mcp-servers.js'
import { mcpGrants, withMcp, READ_ONLY_PERMISSION, WRITE_PERMISSION, PROPOSE_PERMISSION } from './permissions.js'

// Re-exported so the suites and callers keep naming this module for the
// capability vocabulary — same arrangement as `config-values.ts`'s re-exports,
// a moved export would be a rename dressed up as a file split.
export { READ_ONLY_PERMISSION, WRITE_PERMISSION, PROPOSE_PERMISSION }

/**
 * Model facts an operator states outright, for a model no catalogue carries.
 *
 * `null` is not a default — it is "nobody said", which is what lets a lower
 * precedence tier answer instead. Writing a zero here would *pin* the broken
 * value that this whole change exists to stop emitting.
 */
export interface ModelOverrides {
  context: number | null
  output: number | null
  reasoning: boolean | null
}

/** Nothing declared: the ordinary case, and the shape an absent block takes. */
export const NO_MODEL_OVERRIDES: ModelOverrides = { context: null, output: null, reasoning: null }

/**
 * Which model and how much effort each agent profile gets.
 *
 * `null` throughout means "not configured", and each `null` leaves its key out of
 * the emitted config rather than writing a value equal to the default — which is
 * what makes an unset variable byte-identical to the behaviour before these knobs
 * existed.
 */
export interface ModelProfiles {
  /**
   * Model for the read-only `plan` profile and for `small_model`; `null` uses the
   * main model, as every profile did before.
   *
   * `propose` and `build` deliberately keep the main model: drafting a spec and
   * writing code are not the cheap half of this pipeline, and a weak spec is the
   * input to every later phase.
   */
  light: string | null
  planEffort: string | null
  buildEffort: string | null
}

/** Nothing configured: the ordinary case, and the shape an absent block takes. */
export const NO_MODEL_PROFILES: ModelProfiles = { light: null, planEffort: null, buildEffort: null }

/**
 * What this run knows about its model, in the shape OpenCode's own config accepts.
 *
 * The field names are models.dev's and OpenCode's alike, which is what makes the
 * splice a copy rather than a translation. Every field is optional and an unknown
 * one is **omitted**, never zeroed: OpenCode merges this config provider over its
 * own catalogue row, so an absent key leaves that merge free to answer while a
 * `limit: { context: 0 }` would pin the value that switches auto-compaction off.
 */
export interface ModelFacts {
  limit?: { context: number; output: number }
  reasoning?: boolean
  tool_call?: boolean
  temperature?: boolean
  attachment?: boolean
}

/**
 * The only model credentials this pipeline accepts: one OpenAI-compatible
 * endpoint. A base URL plus a key covers OpenAI itself, Azure-style gateways,
 * OpenRouter, vLLM and any other compatible server, so there is no reason to
 * carry provider-specific keys alongside it.
 */
export interface OpenAiSettings {
  apiKey: string
  baseUrl: string
  model: string
  /**
   * Facts stated by the operator, which win over any catalogue.
   *
   * Optional because an absent block and one holding three `null`s mean the same
   * thing, and requiring it of every caller would be ceremony over a shape that
   * only {@link OpenAiSettings} itself ever produces.
   */
  overrides?: ModelOverrides
  /**
   * The resolved answer the overrides and the catalogue agreed on, spliced into
   * the emitted config.
   *
   * Resolved once on the boot path and carried here rather than looked up inside
   * {@link buildOpencodeConfig}, which must stay synchronous: it is the single
   * definition serving both the in-process session and the `OPENCODE_CONFIG_CONTENT`
   * the review loop's subprocesses read, and an async builder would fork that.
   */
  facts?: ModelFacts
  /**
   * Per-profile model and effort. Optional for the reason {@link overrides} is:
   * an absent block and one holding three `null`s mean the same thing.
   */
  profiles?: ModelProfiles
  /**
   * MCP servers declared through `AGENT_MCP_SERVERS`, or nothing declared.
   *
   * Rides here the way {@link profiles} does — one field on the one settings
   * object both execution paths read — so `buildOpencodeConfig` stays
   * synchronous and the in-process session and the review loop's
   * `OPENCODE_CONFIG_CONTENT` cannot carry different server sets. An empty map
   * and an absent field mean the same thing: nothing emitted.
   */
  mcpServers?: McpServers
  /**
   * The **catalogue** id the model is resolved under — `LLM_PROVIDER`, or
   * {@link DEFAULT_PROVIDER_ID}.
   *
   * Deliberately not the transport, which is always {@link PROVIDER_NPM}.
   * OpenCode merges this config provider over its own models.dev-derived
   * database keyed by this id and then by the model id, and a row it does not
   * find contributes nothing: `limit.context` 0 (which switches auto-compaction
   * off outright) and `reasoning` false (which empties the effort variants). So
   * `anthropic` here with an OpenAI-compatible gateway as the base URL borrows
   * Anthropic's catalogue row while still speaking the OpenAI wire protocol.
   *
   * See `config-values.ts`'s `providerId` for the shape and why a slash is
   * refused.
   */
  provider: string
}

/** Provider id used when `LLM_PROVIDER` says nothing, i.e. today's behaviour. */
export const DEFAULT_PROVIDER_ID = 'openai'

/**
 * The AI SDK package OpenCode loads for this provider. The `openai-compatible`
 * driver — not the first-party `openai` one — is what makes `LLM_BASE_URL`
 * meaningful for non-OpenAI endpoints.
 *
 * Pinned here rather than inherited from the catalogue row, and the merge order
 * is what makes that work: OpenCode resolves a model's package as
 * `model.provider?.npm ?? provider.npm ?? existingModel?.api.npm ?? …`, so this
 * value wins over whatever package the borrowed row names.
 */
const PROVIDER_NPM = '@ai-sdk/openai-compatible'

/** `<provider>/<model>`, the reference form both the SDK and `opencode run` expect. */
export const modelRef = (settings: OpenAiSettings): string => `${settings.provider}/${settings.model}`

/**
 * Builds the OpenCode configuration that pins the provider, the endpoint and
 * the model.
 *
 * The same object serves both execution paths: it is handed to
 * `createOpencodeServer({ config })` for the in-process session, and serialized
 * into `OPENCODE_CONFIG_CONTENT` for the `opencode run` subprocesses the
 * review-loop workspace spawns. One definition, so the two cannot drift.
 *
 * The capability maps and the generated MCP grant keys live in
 * `permissions.ts`, split from here when the MCP emission pushed this file
 * past `max-lines` — the policy and the builder change for different reasons.
 */
/**
 * A profile's entry: its permission, and whichever of model and effort was named.
 *
 * The two optional halves are **omitted** when unset rather than written as the
 * value they would default to, which is what keeps an unconfigured run's emitted
 * config identical to the one it produced before these knobs existed.
 *
 * `variant` is not on the pinned SDK's `AgentConfig` type, which carries an index
 * signature that accepts it — and the server *does* read it: `opencode-ai@1.18.7`'s
 * agent loader merges `model`, `variant`, `options`, `temperature`, `top_p` and
 * `steps` from each config agent entry. The two pins are different versions, and
 * the server's is the one that resolves configuration.
 */
const profile = (
  permission: Record<string, 'allow' | 'deny'>,
  overrides: { model?: string; variant?: string | null },
): Record<string, unknown> => ({
  permission,
  ...(overrides.model === undefined ? {} : { model: overrides.model }),
  ...(overrides.variant === undefined || overrides.variant === null ? {} : { variant: overrides.variant }),
})

/** `<provider>/<model>` for a model other than the main one. */
const lightRef = (settings: OpenAiSettings): string | undefined => {
  const light = settings.profiles?.light
  return light === undefined || light === null ? undefined : `${settings.provider}/${light}`
}

/** The one provider block, its credentials and everything known about its model. */
const providerBlock = (settings: OpenAiSettings): NonNullable<Config['provider']>[string] => ({
  npm: PROVIDER_NPM,
  name: 'OpenAI-compatible',
  options: {
    apiKey: settings.apiKey,
    baseURL: settings.baseUrl,
    // `ProviderTransform` emits a `promptCacheKey` for this driver only when this
    // is `true`, and the key is the session id. Unconditional rather than behind a
    // knob of its own: a provider that ignores the field is unaffected, and a long
    // phase otherwise pays full input price on a prompt mostly identical to the
    // last one.
    setCacheKey: true,
  },
  // The facts ride *on the model entry*, which is the only place OpenCode reads
  // them from. An unresolved fact is absent rather than zero — see
  // {@link ModelFacts}.
  models: { [settings.model]: { name: settings.model, ...settings.facts } },
})

/**
 * The three profiles, and which model and effort each gets.
 *
 * Its own function so `buildOpencodeConfig` stays inside `max-lines-per-function`,
 * and because this is where most of this file's reasoning lives: what each profile
 * is *for* is the whole argument for what it may do and what it costs.
 */
const agentProfiles = (
  settings: OpenAiSettings,
  light: string | undefined,
  grants: Record<string, 'allow'>,
): Config['agent'] => {
  const profiles = settings.profiles ?? NO_MODEL_PROFILES

  return {
    // The phases that only read the repository — triage, planning, answering a
    // question, classifying a comment — all prompt with `agent: 'plan'`. They have
    // no reason to edit a file or run a command, and denying it means a successful
    // injection during the two *review* gates, before a maintainer has approved
    // anything, cannot reach the working tree at all. This is also the one profile
    // the light model is given: no write permission, and its phases are
    // classification and short answers. Its tools are read-shaped, but the MCP
    // grant still lands here: a declared server's read-shaped tools are exactly
    // what the read-only phases exist to use.
    plan: profile(withMcp(READ_ONLY_PERMISSION, grants), { model: light, variant: profiles.planEffort }),
    // The artefact-drafting turns (design D8): read plus edit, confined by the diff
    // guard to `openspec/changes/<change-name>/`. No `bash`. Deliberately **not**
    // given the light model — a weak spec is the input to every later phase, and
    // the gates that would catch it cost wall clock rather than tokens. And
    // deliberately no MCP grant either (the knob design's D1): this is the most
    // confined profile the pipeline prompts, and MCP tools would be its only
    // unconfined egress — drafting turns compose prose, not tool calls.
    propose: profile(PROPOSE_PERMISSION, {}),
    // Implementation and CI repair, and the review-loop subprocesses: `opencode
    // run` without `--agent` resolves to the primary agent, which
    // `opencode agent list` reports as `build`. That is exactly why the effort is
    // set here rather than per call — a per-call setting could never reach a
    // subprocess this process does not prompt.
    build: profile(withMcp(WRITE_PERMISSION, grants), { variant: profiles.buildEffort }),
  }
}

export const buildOpencodeConfig = (settings: OpenAiSettings): Config => {
  const light = lightRef(settings)
  const grants = mcpGrants(settings.mcpServers)
  const mcp = mcpBlock(settings.mcpServers)

  return {
    $schema: 'https://opencode.ai/config.json',
    provider: { [settings.provider]: providerBlock(settings) },
    model: modelRef(settings),
    // Title and summary generation, which have no business on the model an
    // implement turn uses. Emitted only when a light model was named.
    ...(light === undefined ? {} : { small_model: light }),
    // The declared MCP servers, if any: one block both execution paths read.
    ...(mcp === undefined ? {} : { mcp }),
    // The weaker profile is the default, so an agent this pipeline does not name
    // inherits the restricted set rather than a free pass — with the generated
    // MCP grants on top, since deny-by-default would otherwise keep every MCP
    // tool invisible to any agent the pipeline does not explicitly name.
    permission: withMcp(READ_ONLY_PERMISSION, grants),
    agent: agentProfiles(settings, light, grants),
  }
}

/**
 * Environment carrying the config to a spawned `opencode` process.
 *
 * Delivered inline rather than as a file because the runner may have no
 * writable home, and because a config file inside the repo would be visible to
 * `git add --all`. **This value contains the API key** — never log it.
 */
export const opencodeConfigEnv = (settings: OpenAiSettings): Record<string, string> => ({
  OPENCODE_CONFIG_CONTENT: JSON.stringify(buildOpencodeConfig(settings)),
})
