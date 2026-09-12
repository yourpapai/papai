<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Per-phase model and inference parameters

## Why

The pipeline declares one model and one set of inference parameters — none —
for every phase. Triage, comment classification, answering a question and the
two review gates all prompt with `agent: 'plan'` and no write permission, yet
run on the same model as a thirty-step implement turn; `small_model` is unset,
so session-title generation burns it too. No reasoning effort is ever
requested, for any phase. And `provider.options.setCacheKey` is unset, so
`ProviderTransform` never emits a `promptCacheKey` for an OpenAI-compatible
provider — every turn of a long phase pays full input price on a prompt mostly
identical to the last one.

The three agent profiles already exist and already differ, but only in
permissions (`openai-config.ts:113`) — the natural place for this. Verified
against the deployed runtime (`opencode-ai@1.18.7`, not only the pinned SDK):
its agent loader reads `model`, `variant`, `options`, `temperature`, `top_p`
and `steps` from each config agent entry.

## What Changes

- `LLM_MODEL_LIGHT` (optional, defaults to `LLM_MODEL`) — the model for the
  read-only `plan` profile and for `small_model`. `propose` and `build` keep
  the main model: drafting a spec and writing code are not the cheap half.
- `AGENT_EFFORT_PLAN` and `AGENT_EFFORT_BUILD` (optional, unset = OpenCode's
  default) — the reasoning variant per profile, set as `agent.<name>.variant`.
  Config-level rather than per-call, so the in-process session and the review
  loop's `opencode run` subprocesses (which resolve to `build`) are treated
  alike from one definition.
- `provider.<id>.options.setCacheKey: true`, so a provider honouring a prompt
  cache key receives one.

## Capabilities

### New Capabilities

None — configuration confined to `opencode-agent/`; no papai runtime behavior
changes. `skip_specs: true` is set in `.openspec.yaml`.

### Modified Capabilities

None. `openspec/specs/` is empty (strangler); nothing to modify.

## Non-goals

- **No effort without metadata.** An effort variant only exists when
  `capabilities.reasoning` is true, which is what
  `opencode-agent-model-catalogue-provider` and
  `opencode-agent-model-metadata-fallback` establish. This change depends on
  them and does not re-litigate them.
- **No second endpoint.** `LLM_MODEL_LIGHT` names a model on the *same* base
  URL and key; a second provider would double the credential surface the proxy
  exists to keep at one. Declined.
- **No agent `steps` bound.** A doom loop is bounded only by the turn deadline
  today — a real gap, but a wall-clock question belonging next to
  `turn-stop.ts`. Declined, left for its own change.
- **No `temperature` / `top_p` knobs.** OpenCode already derives a per-model
  temperature; no evidence a hand-set one helps. Declined.
- **No papai runtime impact**: no platform-instance or task-instance surface,
  no config-context scope impact, no new persisted state.

## Impact

- **Code:** `opencode-agent/src/openai-config.ts` (agent entries, `small_model`,
  `setCacheKey`), `config.ts`, `config-values.ts`, `config-shape.ts`.
- **Tests:** `tests/opencode-agent/` `openai-config`, `config` and
  `provider-proxy` suites.
- **Behavior:** read-only phases move to a cheaper model; the `AGENT_STATE`
  token budget keeps counting both against one ceiling.
- **Docs:** `opencode-agent/README.md` env table and `CLAUDE.md`.
