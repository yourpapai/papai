<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Proposal: Supply model metadata for models no catalogue knows

## Why

`opencode-agent-model-catalogue-provider` makes the agent's model resolve
against OpenCode's models.dev-derived catalogue, which covers every hosted
model worth naming. It does nothing for the case that motivated the pipeline's
design in the first place: **an arbitrary OpenAI-compatible endpoint serving a
model under an id no catalogue carries** — a self-hosted vLLM alias, an
internal gateway's routing name, a fine-tune. Those still fall to
`limit.context: 0`, which switches auto-compaction off outright
(`session/overflow.ts`), and `reasoning: false`, which empties the effort
variants.

The metadata is not hard to obtain and we already obtain it: `sdd-runner/src/pricing.ts`
is a complete models.dev client — `https://models.dev/api.json`, 60-minute disk
cache, bounded fetch, Zod schema, median fallback — that parses only `cost`.
The payload's other fields (`limit.context`, `limit.output`, `reasoning`,
`tool_call`, `temperature`, `attachment`) are exactly the field set OpenCode's
`provider.models.<id>` config accepts, one for one.

## What Changes

- `sdd-runner/src/pricing.ts` gains a lookup returning the **whole** catalogue
  entry rather than only its cost. Its existing consumer keeps reading `cost`
  through the same call.
- `buildOpencodeConfig` splices the resolved `limit`, `reasoning`, `tool_call`,
  `temperature` and `attachment` into the model entry it emits, with a stated
  precedence: explicit env override → models.dev lookup → OpenCode's own
  catalogue merge → today's zero defaults.
- New optional last-resort overrides for a model in no catalogue at all:
  `AGENT_MODEL_CONTEXT`, `AGENT_MODEL_OUTPUT`, `AGENT_MODEL_REASONING`,
  range-checked at load like every other knob.
- The lookup is **best-effort by construction**: an unreachable or slow
  models.dev degrades to the next tier and warns; it never fails a run.

## Capabilities

### New Capabilities

None — dev-tooling change to `opencode-agent/` and `sdd-runner/`; no papai
runtime behavior changes. `skip_specs: true` is set in `.openspec.yaml`.

### Modified Capabilities

None. `openspec/specs/` is empty (strangler); nothing to modify.

## Non-goals

- **No cost splicing.** S5-6 recorded the decision to budget tokens rather than
  currency precisely because an unpriced model is the ordinary case here; a
  real price would invite a currency ceiling that decision rejected. Declined.
- **No repair of `src/model-context.ts`.** papai's runtime keeps its own stale
  prefix table and missing `providerOptions`; the same defect in a different
  consumer, and a papai-runtime change rather than a dev-tooling one. Declined.
- **No per-phase differentiation** — scoped to
  `opencode-agent-per-phase-model-params`.
- **No SDK pin move**; every field spliced here exists on the pinned 1.18.12.
- **No papai runtime impact**: no platform-instance or task-instance surface,
  no config-context scope impact, no new persisted state keyed by any context
  id.

## Impact

- **Code:** `sdd-runner/src/pricing.ts` (widen the returned entry),
  `opencode-agent/src/openai-config.ts`, `config.ts`, `config-values.ts`,
  `config-shape.ts`, and the boot path assembling settings.
- **Tests:** `tests/sdd-runner/pricing.test.ts`, `tests/opencode-agent/` config
  and `openai-config` suites.
- **Network:** a new outbound host on the agent's boot path, bounded and
  cached; `bun security` covers the fetch surface.
- **Docs:** `opencode-agent/README.md` env table, `opencode-agent/CLAUDE.md`,
  `sdd-runner`'s note in `docs/architecture/sdd-pipeline.md`.
