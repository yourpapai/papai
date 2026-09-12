<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See proposal.md — Why. The mechanics that constrain the fix:

- `contain.ts:159` (`claudeSessionOptions`) hands the claude session
  `pricing: contained.openai` — the whole settings object, with a comment saying
  only `provider` and `model` are read from it.
- `claude-adapter.ts:251` → `claude-spend.ts:91` → `run-spend.ts:144`, where
  `modelRef(settings)` composes `${provider}/${model}`. `provider` is
  `LLM_PROVIDER` (`config.ts:88`, default `openai`), a knob `openai-config.ts`
  documents as the id **OpenCode** resolves its catalogue row under.
- `claude-argv.ts:116` already owns the one definition of the id the CLI is
  invoked with: `modelIdForCli`, which strips a `provider/` prefix.
- `claude-contract.ts:203` defaults `total_cost_usd` to `0`, so the catalogue
  rung is genuinely reachable on this route — the reference is not decoration.
- `index.ts:192` (`withModelFacts`) skips the boot-time catalogue read on the
  claude route. That is the read the docs describe; the spend-time one was
  missed.
- `contain.ts` is **297 lines** against a 300-line `max-lines` cap. Where the
  derivation lives is therefore a constraint, not a preference.

## Goals / Non-Goals

**Goals:**

- One derivation, at the seam that already composes the claude session's
  options, so the pricing reference and the CLI invocation cannot name different
  models.
- No behaviour change on the opencode route — not to the composed reference, the
  ladder, or the emitted OpenCode config.

**Non-Goals:**

- Re-shaping `resolveRunCost`'s input. It takes `OpenAiSettings` and serves both
  routes; narrowing it to a `reference: string` is a wider diff for no behaviour
  the specs ask for.
- Teaching `run-spend.ts` which backend ran. It has no backend awareness today
  and gains nothing by having one — the caller already knows.

## Decisions

### D1 — The claude route prices under `anthropic`, unconditionally

`LLM_PROVIDER` is a gateway-route catalogue key; the claude route reaches
Anthropic. The CI workflow forwards no `ANTHROPIC_BASE_URL`
(`agent-pipeline.yml:495-530`), so on the shape this pipeline actually runs, the
CLI's endpoint is Anthropic's. This is also what `README.md:2113` already
promises, so the fix makes the code match documentation rather than the reverse.

*Alternatives considered.* Keeping `LLM_PROVIDER` and fixing only the prefix
duplication preserves operator control for a redirected CLI, but leaves the
misleading log line and requires the operator to know a models.dev-valid id.
A dedicated `AGENT_PRICING_PROVIDER` knob is cleaner in principle and costs a
variable to document, forward and test for a case the backend rung already
covers. `anthropic`-by-default-with-override is today's behaviour whenever the
variable is set, which is exactly the reported case.

*Residual.* An operator who redirects the CLI at a gateway locally (the parent's
`claude-connect.ts:35` strip list does not carry `ANTHROPIC_BASE_URL`, unlike
review-loop's documented superset) is priced at Anthropic rates **only** if that
gateway also reports no cost of its own. Recorded in Risks.

### D2 — The derivation lives in `claude-spend.ts`, called from `contain.ts`

`claude-spend.ts` (105 lines) already owns "what a claude session's spend is",
and is the module `run-spend.ts` is reached through. It exports the derived
settings; `contain.ts` changes one expression and gains one import — the only
shape that fits under its 3-line headroom. Putting it in `contain.ts` inline, or
in a new module, both cost more there for no separation gained.

`claude-argv.ts` exports `modelIdForCli` for it to use rather than the strip
being written twice. That export is the load-bearing half of the decision: it is
what makes "the id the CLI ran" and "the id the run was priced under" the same
value by construction rather than by two functions agreeing.

### D3 — `pricing` stays an `OpenAiSettings`, derived by spread

A copy with `provider` and `model` replaced, still carrying the placeholder key
and empty base URL the contained settings hold. Design D5 of the claude-backend
change forbids the *credential* crossing this seam, not the model's name, and
the field's existing type and its one consumer both stay as they are.

## Risks / Trade-offs

- **A locally redirected CLI is priced under Anthropic on the catalogue rung** →
  The backend rung outranks it and answers whenever the gateway reports a cost.
  An operator who needs otherwise gets a knob as a follow-up change, with the
  field evidence to justify it.
- **A run that reported a median cross-provider price now reports Anthropic's
  own** → Figures shift for affected issues, in the direction of being correct.
  Past totals are not restated (proposal — Non-goals).
- **A future non-Anthropic claude-compatible backend would need this revisited**
  → It is one constant behind one exported function, named for what it is.

## Test-first order and hook interactions

The Write/Edit TDD hook gates each source edit on a failing test first. Work in
this order, one red test per step:

1. `tests/opencode-agent/provider-proxy.test.ts` — its `contain (claude route)`
   block already loads `LLM_MODEL: 'anthropic/claude-sonnet-5'` and asserts
   `knobs` but never `pricing`. Assert `pricing` there: `provider: 'anthropic'`,
   `model: 'claude-sonnet-5'`. Red today (`openai` / `anthropic/claude-sonnet-5`).
2. A case with `LLM_PROVIDER` set to a gateway id, pinning that it does not reach
   the reference.
3. `tests/opencode-agent/run-spend.test.ts` — the ladder itself is unchanged;
   add the leg proving a reference whose model id still carries a provider
   prefix resolves to no catalogue row, so the regression stays pinned from the
   consuming side.

No new file is created, so no new hook path is opened. No DB, no migration, no
tool surface, no capability or `tool_prefs` gating, and no scope-model id — this
is the GitHub Actions issue agent, outside papai's runtime.
