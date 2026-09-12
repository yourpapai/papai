// SPDX-License-Identifier: BUSL-1.1
// Copyright (c) 2026 Dmitriy Lazarev
// Use of this software is governed by the Business Source License 1.1.
// See LICENSE in the project root for details.

import { ConfigError } from './config-values.js'
import type { Env, IntRange } from './config-values.js'
import { optional, optionalOrNull } from './config-values.js'

/**
 * Every knob that describes **which model this pipeline is talking to**, and the
 * shapes and ranges that refuse the values which cannot work.
 *
 * Split out of `config-values.ts` when that file passed `max-lines`, along the
 * seam the overflow pointed at rather than an arbitrary cut: these are the only
 * knobs that are not about *this pipeline* at all. Every other value there bounds
 * something the runner does — rounds, files, lines, a wall clock — where these
 * four state facts about somebody else's server, which is why their prose is
 * about OpenCode's resolution rules rather than about a budget.
 *
 * `config-values.ts` re-exports all of it, so no caller names this module. Same
 * arrangement as `config-clock-values.ts` and `check-spec.ts`, and deliberate:
 * the split is about where the *reasoning* lives, not about giving callers a
 * second import to choose between.
 */

/**
 * A hand-declared context window, for a model no catalogue carries.
 *
 * The floor is one phase's own prompt: `prompt-budget.ts` spends 12,000 tokens on
 * the thread and as many again on check output, so a window beneath that compacts
 * on every turn and never gets anywhere. The ceiling is above every model that
 * exists and below the numbers that would remove the bound — a made-up window is
 * never reached, so compaction never fires and the knob has disabled the very
 * thing it exists to enable.
 */
export const CONTEXT_RANGE: IntRange = { min: 16_000, max: 2_000_000 }

/**
 * A hand-declared output cap.
 *
 * The ceiling is OpenCode's own `OUTPUT_TOKEN_MAX`: `maxOutputTokens` reads
 * `Math.min(model.limit.output, 32_000) || 32_000`, so anything above this is
 * silently clamped and setting it is a statement about the run that is not true.
 */
export const OUTPUT_RANGE: IntRange = { min: 1_024, max: 32_000 }

/**
 * Reads a knob whose absence is meaningful and whose value is a plain yes or no.
 *
 * Strict on purpose, in the spirit of the numeric readers beside it: `yes`, `1`
 * and `on` are all things somebody would reasonably type and all things a lenient
 * parser would have to guess about, and a mis-read `reasoning` either claims an
 * effort tier the model does not have or hides one it does. So exactly two words
 * are accepted, in any case, and everything else is a message naming the variable.
 */
export const boolOrNull = (env: Env, key: string): boolean | null => {
  const raw = optionalOrNull(env, key)
  if (raw === null) return null

  const normalized = raw.toLowerCase()
  if (normalized === 'true') return true
  if (normalized === 'false') return false
  throw new ConfigError(`${key} must be \`true\` or \`false\`, got ${JSON.stringify(raw)}`)
}

/**
 * Longest effort tier accepted, and the shape one may take.
 *
 * Deliberately a **shape** check and not a list. The valid set is model-dependent
 * — OpenCode's `transform.ts` computes it from the model id and its release date,
 * so `minimal` exists for one GPT-5 generation, `none` for another, `xhigh` only
 * above a date, and `max` for one DeepSeek line — and a list copied here would
 * reject tiers that work and be wrong on the next model. So this refuses what
 * cannot be a tier at all, and OpenCode refuses the rest, where the knowledge is.
 *
 * The cost, accepted deliberately: a typo surfaces at the first prompt rather
 * than at load, which is the opposite of what this file prefers everywhere else.
 * A hardcoded list makes that *more* likely, not less. Exported only as the
 * cross-workspace pin's subject (`tests/opencode-agent/claude-doctrine.test.ts`),
 * not as a second import path — `config-values.ts` stays the caller's door.
 */
export const EFFORT_MAX_LENGTH = 16
export const EFFORT_PATTERN = /^[a-z][a-z0-9-]*$/u

/**
 * Reads a reasoning-effort tier, or `null` when the operator named none.
 *
 * `null` leaves the profile's `variant` out of the emitted config entirely,
 * which is what makes an unset variable byte-identical to the behaviour before
 * these knobs existed.
 */
export const effortTier = (env: Env, key: string): string | null => {
  const configured = optionalOrNull(env, key)
  if (configured === null) return null

  if (configured.length > EFFORT_MAX_LENGTH) {
    throw new ConfigError(`${key} must be at most ${EFFORT_MAX_LENGTH} characters, got ${configured.length}`)
  }
  if (!EFFORT_PATTERN.test(configured)) {
    throw new ConfigError(
      `${key} must be a lowercase effort tier such as \`low\`, \`high\` or \`xhigh\`, got ${JSON.stringify(configured)}`,
    )
  }
  return configured
}

/**
 * Longest catalogue provider id accepted. Generous: the longest ids OpenCode's
 * own catalogue carries are of the order of `zai-coding-plan`, and this bound
 * exists to refuse a pasted URL, not to be tight.
 */
const PROVIDER_ID_MAX_LENGTH = 64

/**
 * Shape a catalogue provider id may take.
 *
 * A slash is the one character that must not appear, and not on taste:
 * `parseModelRef` splits `provider/model` at the **first** slash and keeps the
 * whole remainder as the model id, so `a/b` here would parse back as provider
 * `a` and model `b/<model>`. Lowercase because the ids are catalogue keys
 * compared literally, and a leading separator because no real id starts with
 * one and it is the shape a half-typed value takes.
 */
const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/u

/**
 * Reads the provider id the model is resolved **under**, which is not the same
 * question as which endpoint it is served from.
 *
 * OpenCode builds its model database from its models.dev catalogue and merges a
 * config provider *over* it, keyed by this id and then by the model id. A model
 * the resulting row does not carry inherits nothing: `limit.context` 0, which
 * makes `isOverflow` return `false` unconditionally and switches auto-compaction
 * off, and `reasoning` false, which makes `variants()` return an empty set so no
 * reasoning effort is selectable at all. The transport stays
 * `@ai-sdk/openai-compatible` whatever this says, so naming a real provider here
 * borrows its catalogue row without loading its SDK package.
 *
 * Validated at load, where a bad value is a message naming the variable, rather
 * than at the first prompt, where it is metadata silently missing.
 */
export const providerId = (env: Env, key: string, fallback: string): string => {
  const configured = optional(env, key, fallback)

  if (configured.length > PROVIDER_ID_MAX_LENGTH) {
    throw new ConfigError(`${key} must be at most ${PROVIDER_ID_MAX_LENGTH} characters, got ${configured.length}`)
  }
  if (!PROVIDER_ID_PATTERN.test(configured)) {
    throw new ConfigError(
      `${key} must be a lowercase catalogue id of letters, digits and \`-_.\` with no slash, got ${JSON.stringify(configured)}`,
    )
  }
  return configured
}
