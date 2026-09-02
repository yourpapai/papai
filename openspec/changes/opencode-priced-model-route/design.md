<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

## Context

See proposal.md — Why. The mechanics that constrain the edit:

- Cost is computed **inside opencode**, not by the runner: `review-loop/src/agent-command.ts:125`
  spawns `opencode run --auto --format json --model <model> --dir <cwd>`, and each `step_finish`
  part arrives carrying a `cost` field read verbatim at `review-loop/src/event-stream.ts:92`
  (`cost: asNumber(rawPart.cost)`). Opencode prices a turn from its provider table — the
  models.dev catalogue merged with any `provider.<id>.models.<mid>.cost` block declared in
  `opencode.json` (USD per 1M tokens).
- The runner-side flow: `afk-runner/src/agent-reporter.ts:50` lifts `delta.cost` onto the
  `step_finish` event, `afk-runner/src/agent-layer.ts:196` emits `done` with `usage.costUsd`, and
  the acceptance oracle is the predicate at `afk-runner/src/work/gate-signals.ts:139` —
  `costUsd === 0 && tokens > 0 → costKnown: false` (mirrored in `afk-runner/src/analyze-usage.ts:46`).
- Current machine-global state (`~/.config/opencode/opencode.json`): the `agent` block routes
  `general`/`explore`/`scout` to `zai-coding-plan/glm-5.3-flash` — the C8 fallback; the
  `provider` block holds `synthetic`, `localhost`, `kontur` only. The priced template is
  `provider.synthetic.models["hf:zai-org/GLM-5.3-Flash"].cost` =
  `{ input: 0.075, output: 0.25, cache_read: 0.015, cache_write: 0 }`.
- models.dev carries no price for the subscription provider, so opencode reports `0` and
  `costKnown` stays false — the state C8 recorded (`usage.costKnown: false` everywhere after the
  switch, `openspec/changes/v2-live-proof/corpus-report.json`).
- Config model metadata **merges** onto the existing provider entry rather than replacing it —
  the established path `opencode-agent/src/model-metadata.ts` + `buildOpencodeConfig` already
  rely on (opencode's resolution chain defers to `existingModel` for anything a config entry
  omits). A models-only `provider["zai-coding-plan"]` block therefore needs no `npm`,
  `baseURL`, or credential restatement.

## Goals / Non-Goals

**Goals:**

- The model route SDD cycles resolve reports non-zero `cost` in opencode's provider table, at
  that model's official API list rates.
- Verified end to end through the runner's own oracle — a probe spawn's `done` event carries
  `costUsd > 0` and `usageTotalsOf`/`costSummaryOf` read `costKnown: true`.
- Entirely machine-local: one config edit plus this folder as the runbook and verification
  record.

**Non-Goals:**

- No change to **which** model the cycles use — the coding-plan route stays the route; the
  `synthetic` entry stays untouched as template and coexisting alternative.
- No review-loop `pricing` map edit — that is the loop's own estimated-cost display
  (`review-loop/src/cost.ts`), a separate consumer with separate semantics.
- No reprice pass in afk-runner — master's `resolveCost` reprice seam is deliberately not
  mirrored there (`docs/architecture/afk-runner.md`, metric inventory).

## Decisions

### D1 — Shadow-price the existing coding-plan route, not a new route

Add `provider["zai-coding-plan"].models["<id>"].cost` for **each model id the route resolves**
(the `agent` block names `glm-5.3-flash`; C8's fallback also ran `glm-5.3` — enumerate with
`opencode models` at execution time). Rationale: zero launch-surface change — no `AFK_RUNNER_MODEL`
value, `agent` block, or task-file edit — so every future cycle and every ad-hoc `opencode run`
inherits pricing, and the drill does not depend on the unstable synthetic endpoint.

Alternatives rejected: registering a new stable route would repoint the agent block and couple
the drill to a new route's reliability for the same oracle; waiting for the synthetic endpoint
to stabilize is provider-side and unbounded.

### D2 — Rates are per-model official API list prices, re-verified at execution time

The Flash rates may be re-checked against the synthetic entry's numbers but only after checking
the official pricing page; a non-Flash id gets **its own** rates, never a copy of the Flash row.
`cache_write` stays a declared field (0 where the provider bills nothing for writes). Rationale:
one copied rate row would silently misprice non-Flash spend, and C9's ceiling calibration (from
measured burn) would inherit the error.

### D3 — Semantics: list-price metering, not billed spend

The subscription still does not bill per token; after this change `done.usage.costUsd` reads
"what this run would have cost at API rates" — the same honest reading the claude route's
`total_cost_usd` list-price doctrine already established. That is exactly the figure the
numeric-ceiling drill needs: a real-rate projection crossing a calibrated ceiling.

### D4 — Verification is the runner's oracle, probed at two levels

Level 1 (opencode alone): one `opencode run --format json --model zai-coding-plan/glm-5.3-flash`
probe whose `step_finish` part carries `cost > 0`. Level 2 (runner seam): a probe spawn recorded
through the runner so its `done` event carries `costUsd > 0` and `costSummaryOf` reads
`costKnown: true` — readable via `analyze` on the probe's work dir, which renders `cost known`.

Surface-impact check (per artifact rules): no new tool surface — capability and `tool_prefs`
gating untouched; no persisted repo state — scope ids (storage/config context, platform
instance, user) key nothing new; no DB migration; no new dependency; no new module; no gateable
files — the machine config and this folder sit outside the Write/Edit TDD hook's gateable set,
so no test-first ordering applies.

## Risks / Trade-offs

- [A bare `provider["zai-coding-plan"]` entry shadows rather than merges the built-in provider]
  → Level-1 probe catches it immediately (`opencode models` still lists the route; probe cost
  `> 0`); fallback is fully specifying the entry, or attaching the cost under a locally
  registered route instead — the same oracle decides.
- [Official rates drift after verification] → re-verified at execution time per proposal; later
  drift misprices by the ratio of the change — budget/display impact only, never correctness.
- [Metered spend reads as if billed] → the gate render keeps its `metered` marker and this
  folder records the shadow-pricing reading; same doctrine as claude list-price.
- [The edit is machine-global and uncommitted] → this change folder is the record (proposal:
  operator runbook and verification record); rollback is deleting the added cost blocks — one
  edit, no other state; archived run logs keep their recorded values; new runs revert to
  `costKnown: false`.
- [Pricing routes that were not the target] → cost blocks attach only to `zai-coding-plan`
  model ids the SDD route resolves; the `synthetic` entry is untouched.
