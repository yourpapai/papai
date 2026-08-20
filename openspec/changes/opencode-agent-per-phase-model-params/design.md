<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Design: Per-phase model and inference parameters

## Context

See `proposal.md` — Why. Three facts about the substrate that the decisions
below all turn on, each read from the versions actually deployed rather than
inferred:

- **Two pins, not one.** The SDK is `@opencode-ai/sdk@^1.18.12`; the binary
  that resolves configuration is `opencode-ai@1.18.7`, installed globally by
  `.github/workflows/agent-pipeline.yml` and spawned by
  `createOpencodeServer`. The **server** version is what reads the config, so
  that is the version this design is checked against.
- At 1.18.7 the agent loader reads `model`, `variant`, `options`,
  `temperature`, `top_p` and `steps` from each config agent entry
  (`packages/opencode/src/agent/agent.ts:281-292`). The pinned SDK's generated
  `AgentConfig` type declares only a subset, but carries an index signature, so
  the extra keys are accepted by the type and honoured by the server.
- An effort variant exists only when `capabilities.reasoning` is true:
  `ProviderTransform.variants()` opens with `if (!model.capabilities.reasoning)
  return {}`. That capability is what the two prerequisite changes establish;
  without them every effort knob here is inert.

The three profiles this change parameterises are already defined and already
differ by permission: `plan` (read-only — triage, comment classification,
answering, both review gates), `propose` (read plus edit, confined by the diff
guard to the change folder, D8), `build` (implement, CI-fix, and the review
loop's subprocesses, which resolve to the primary agent).

## Goals / Non-Goals

**Goals:**

- Read-only phases stop paying implement-phase prices.
- Implement gets the effort the model can actually offer.
- One definition covering both execution paths.

**Non-Goals:**

- Establishing the metadata the effort depends on (prerequisite changes).
- A second endpoint, a `steps` bound, or hand-set sampling parameters — see
  proposal — Non-goals.

## Decisions

### D1 — Configure the profile, not the call site

Effort and model are set on `agent.<name>` in the emitted config rather than
per prompt. Two reasons, and the second is the load-bearing one:

- The pinned SDK's prompt body has **no** `variant` field
  (`SessionPromptData.body` is `{messageID, model, agent, noReply, system,
  tools, parts}`), so per-call effort is not expressible at this pin at all.
- The review loop shells out to `opencode run --model … --dir …` with no
  `--agent`, which resolves to the primary agent, `build`. A config-level
  setting reaches it; a per-call one in `opencode-adapter.ts` never could. This
  is the same argument `openai-config.ts` already records for why one config
  object serves both paths.

*Alternative considered — pass `--variant` to the subprocess and a per-call
option to the SDK.* Rejected: two mechanisms, one of which does not exist at
the pin, for one setting.

### D2 — Light model on `plan` only

`propose` drafts proposal/spec/design/tasks content and `build` writes code;
neither is the cheap half of the pipeline. `plan` is the profile with no write
permission at all, and its phases are classification and short answers. So
`LLM_MODEL_LIGHT` lands on `plan` and on top-level `small_model` (title and
summary generation), and nowhere else.

*Alternative considered — light model for `propose` too.* Rejected: a weak
spec is the input to every later phase, and the review gates that would catch
it are human parks costing wall-clock rather than tokens.

### D3 — Defaults are today, in every knob

`LLM_MODEL_LIGHT` unset falls back to `LLM_MODEL`; the effort variables unset
emit no `variant` at all. A repository that sets none of the three gets an
emitted config differing from today only by `setCacheKey`, which is itself
inert on a provider that ignores it.

### D4 — Effort values are passed through, not enumerated

The accepted tier names differ per model family and per release date
(`transform.ts` computes them from the model id — `minimal`, `none`, `low`,
`medium`, `high`, `xhigh`, `max` across families). Validating against a fixed
list here would mean re-implementing that table and being wrong on the next
model. The loader therefore range-checks only the *shape* — a short lowercase
token — and lets OpenCode reject an unknown tier, where the knowledge lives.

*Consequence accepted:* a typo surfaces at the first prompt rather than at
load, which is the opposite of what `config-values.ts` prefers. The trade is
deliberate and recorded: a wrong-but-well-formed value is unavoidable for a
knob whose valid set is model-dependent, and a hardcoded list makes it *more*
likely by rejecting valid new tiers.

### D5 — `setCacheKey` is opt-in upstream, so we opt in

`ProviderTransform` emits `promptCacheKey` for `@ai-sdk/openai-compatible`
**only** when `provider.options.setCacheKey === true`; the key is the session
id. A provider that ignores the field is unaffected, which is why this is set
unconditionally rather than behind a fourth env var.

## Risks / Trade-offs

- **Version skew between the two pins.** The SDK type and the server's reader
  disagree about which agent keys exist; a future SDK bump could tighten the
  type and reject keys the server still honours. → Mitigation: the emitted
  config is asserted in a unit test, and manual verification runs against the
  installed CLI rather than the SDK's type.
- **A light model that is too light** degrades triage and comment
  classification, which are the phases that decide what the pipeline does at
  all. → Mitigation: defaults to the main model (D3), and `ask-json.ts` already
  re-asks once on a malformed reply — a weak model's failure mode is visible
  there rather than silent.
- **Two models in one token budget.** `tokensSpent` in `AGENT_STATE` counts a
  cheap model's tokens against the same ceiling as an expensive one. → Accepted
  and unchanged: S5-6 recorded that this ceiling is deliberately tokens rather
  than currency, and splitting the counter would reopen that.
- **A prompt cache key changes provider-side behavior.** → Low: it is a cache
  hint keyed by session id, ignored where unsupported.

## Migration Plan

Additive and defaulted. Rollback is unsetting the variables; `setCacheKey`
reverts with the code.

## Open Questions

None that would change the approach or the task breakdown. Which effort tier is
right for `build` on this repository's model is a tuning question answered by
running it, not a design question — D4 exists so that answer is a variable
change rather than a code change.
