<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Resolve the agent's model against OpenCode's own catalogue

## Why

`buildOpencodeConfig` (`opencode-agent/src/openai-config.ts:113`) hardcodes the
OpenCode provider id `openai` while `LLM_BASE_URL` points at *any*
OpenAI-compatible endpoint. OpenCode merges config providers **over** its
models.dev catalogue, keyed by that provider id and the model id
(`provider.ts:1424-1502`, v1.18.12). A model that is not an OpenAI catalogue id
therefore inherits nothing and falls to the defaults: `limit.context` **0**,
`limit.output` **0**, `reasoning` **false**, `attachment` **false**, `cost` 0.

Two of those are not tuning misses but correctness cliffs:

- `session/overflow.ts` opens `isOverflow` with `if (model.limit.context === 0)
  return false` — **auto-compaction never fires**. A long implement turn grows
  until the provider rejects it, which the pipeline reports as a dead turn.
- `ProviderTransform.variants()` opens with `if (!model.capabilities.reasoning)
  return {}` — no reasoning effort is selectable for any phase, at any level.

`LLM_MODEL` is a repository variable that is not pinned to an OpenAI model, so
this is the ordinary configuration rather than the exotic one.

## What Changes

- New optional `LLM_PROVIDER` (default `openai`), the **catalogue** provider id
  the model is looked up under. It is deliberately not the transport: `npm`
  stays `@ai-sdk/openai-compatible` and `options.{apiKey,baseURL}` are
  unchanged, so `LLM_PROVIDER=anthropic` + `LLM_MODEL=claude-sonnet-4-6`
  against a gateway inherits the real context window, output cap, reasoning
  flag and price while still speaking the OpenAI wire protocol through the
  provider proxy.
- `OpenAiSettings` carries the provider id; `modelRef` emits
  `<provider>/<model>` for both execution paths (in-process SDK session and the
  review loop's `opencode run --model`). `parseModelRef` already keeps
  everything after the first `/` and needs no change.
- Validation at load, in the style of the other knobs: an id that cannot be a
  catalogue key is a `ConfigError` naming the variable, not a silent miss on
  the first prompt.

## Capabilities

### New Capabilities

None — a configuration change confined to `opencode-agent/`; no papai runtime
behavior changes. `skip_specs: true` is set in `.openspec.yaml`, matching the
precedent of `opencode-agent-openspec-compliance`.

### Modified Capabilities

None. `openspec/specs/` is empty (strangler); nothing to modify.

## Non-goals

- **No metadata synthesis.** A model absent from every catalogue still lands on
  the zero defaults. That is the follow-up change
  `opencode-agent-model-metadata-fallback`; splitting it keeps this change to
  one env var and no network dependency.
- **No per-phase differentiation** (cheap model for read-only phases, effort
  per profile, `small_model`, `setCacheKey`): declined here, scoped to
  `opencode-agent-per-phase-model-params`.
- **No SDK pin move.** `compaction.*`, `tool_output.*` and `agent.variant` need
  a newer OpenCode; everything here works on the pinned 1.18.12.
- **No papai runtime impact**: no platform-instance or task-instance surface,
  no config-context scope impact, no new persisted state keyed by any context
  id. `src/model-context.ts`'s stale prefix table is untouched.

## Impact

- **Code:** `opencode-agent/src/openai-config.ts`, `config.ts`,
  `config-values.ts`, `config-shape.ts`; read-only fan-out through
  `opencode-adapter.ts`, `review-runner.ts`, `provider-proxy.ts`.
- **Tests:** `tests/opencode-agent/` config and adapter suites; the
  `provider-proxy` inlined-config fixture.
- **Workflow/docs:** optional `vars.LLM_PROVIDER` in `agent-pipeline.yml`;
  `opencode-agent/README.md` env table, `opencode-agent/CLAUDE.md`.
