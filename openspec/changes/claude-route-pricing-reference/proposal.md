<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Why

On the claude backend the run's spend path composes its model reference as
`<LLM_PROVIDER>/<LLM_MODEL>` — a catalogue key that belongs to the *other*
route. A job running the Claude CLI with a leftover `LLM_PROVIDER=zai-coding-plan`
logs `Priced this run  model="zai-coding-plan/claude-opus-5"` for a turn that
never touched that provider, and hands the same wrong key to the models.dev
lookup. `opencode-agent/README.md` already promises the opposite ("`LLM_PROVIDER`
… unused here — the claude route skips the models.dev catalogue read"), which is
true only of the boot-time facts read, not of the spend-time one.

Two consequences, one cosmetic and one not:

- The catalogue rung misses its primary row and prices the run from a **median
  across every provider** carrying that bare model id, reported as an exact
  figure.
- A `LLM_MODEL` spelled `provider/model` — documented as supported on this route,
  where the CLI id is stripped — composes `<LLM_PROVIDER>/<provider>/<model>`,
  which splits at the first slash into a model id no provider carries. The run
  reports **unpriced** and the cost silently disappears from the issue's total.

## What Changes

- The claude route prices and logs under `anthropic/<model id>`, with any
  `provider/` prefix stripped from the model id first — the same id the CLI is
  actually invoked with. `LLM_PROVIDER` is ignored on this route, as the docs
  already claim.
- `opencode-agent/README.md` and `opencode-agent/CLAUDE.md` are corrected: the
  claude route skips the *model-facts* catalogue read, not the *pricing* one.
- No change to the opencode route, to the cost ladder's rungs or their order, or
  to what any run reports when the backend states its own figure.

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `agent-run-accounting`: adds a requirement pinning which catalogue key each
  backend's run is priced under. The base spec ships in the not-yet-archived
  change `opencode-agent-usd-spend-and-claude-limits`, so the delta is written
  against that capability path.

## Impact

- `opencode-agent/src/contain.ts` (`claudeSessionOptions`, the `pricing` seam),
  `opencode-agent/src/claude-argv.ts` (`modelIdForCli` becomes shared).
- Docs: `opencode-agent/README.md` (backend-selection checklist),
  `opencode-agent/CLAUDE.md` (provider-id note).
- Tests: `tests/opencode-agent/provider-proxy.test.ts` (its `contain (claude
  route)` block already runs a prefixed `LLM_MODEL` and asserts `knobs` but never
  `pricing`), `tests/opencode-agent/run-spend.test.ts`.
- No papai runtime surface: this is the GitHub Actions issue agent, so no chat
  platform instance, task instance, or config-context scope is touched — no
  per-user, group-shared or thread-isolated state changes.

## Non-goals

- **A knob for the pricing provider.** Declined: the CI workflow forwards no
  `ANTHROPIC_BASE_URL`, so the claude route reaches Anthropic; a redirected
  local run still gets the backend's own figure, which outranks the catalogue.
- **Stripping `ANTHROPIC_BASE_URL` from the parent's claude child env**, where
  `claude-connect.ts`'s list is a documented subset of review-loop's. A separate
  concern with its own security argument.
- **Reconciling already-recorded issue totals.** Past runs keep the figures they
  recorded.
