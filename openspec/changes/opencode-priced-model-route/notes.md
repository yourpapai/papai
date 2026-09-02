<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

Verification record for the machine-config edit this change performs. Executed 2026-09-02,
opencode 1.18.26, macOS.

## The edit

`~/.config/opencode/opencode.json` gained one provider block (models-only — no `npm`, `baseURL`
or credential fields; `synthetic` / `localhost` / `kontur` untouched):

```json
"zai-coding-plan": {
  "models": {
    "glm-5.3-flash": { "cost": { "input": 0.075, "output": 0.25, "cache_read": 0.015, "cache_write": 0 } },
    "glm-5.3":       { "cost": { "input": 1.4,   "output": 4.4,  "cache_read": 0.26,  "cache_write": 0 } }
  }
}
```

The JSON round-trip normalized the file's indentation (tabs → 2 spaces); a semantic diff against
the pre-edit snapshot showed **no** change outside the added block.

## Red state (pre-edit, task 1.1)

```
$ opencode run --auto --format json --model zai-coding-plan/glm-5.3-flash "Reply with the single word ok" \
    | jq -c 'select(.part.type=="step-finish") | .part | {cost, tokens}'
{"cost":0,"tokens":{"total":38111,"input":38031,"output":3,"reasoning":13,"cache":{"write":0,"read":64}}}
```

`cost: 0` beside 38k tokens — the exact `costUsd === 0 && tokens > 0 → costKnown: false` condition
(`afk-runner/src/work/gate-signals.ts:139`) that kept C8's metered ceiling-refusal branch from arming.
Filter note: this opencode spells the part `step-finish` (kebab) on the wire; `step_finish` is the
runner's internal event name (`review-loop/src/event-stream.ts` maps one to the other).

## Enumerated ids (task 1.2)

`opencode models` lists seven: glm-4.7, glm-5-turbo, glm-5.2, glm-5.2-highspeed, glm-5.3,
glm-5.3-flash, glm-5.3-highspeed. **Priced set = {glm-5.3-flash, glm-5.3}** — the machine config's
`agent` block route (`general`/`explore`/`scout`) and C8's fallback spelling respectively. The other
five stay at the subscription catalogue's zeros by design (D2: rates are per-model from the official
page, never a copy); a cycle routing there reverts to `costKnown: false`, which is the honest read.

## Rates and sources (task 1.3)

Official page <https://docs.z.ai/guides/overview/pricing> (fetched 2026-09-02), cross-checked against
models.dev's `zai` API-provider rows — identical figures:

| Model          | input $/M | output $/M | cache_read $/M | cache_write $/M |
| -------------- | --------- | ---------- | -------------- | --------------- |
| GLM-5.3-Flash  | 0.075     | 0.25       | 0.015          | 0               |
| GLM-5.3        | 1.4       | 4.4        | 0.26           | 0               |

`cache_write: 0` mirrors "Cached Input Storage: Limited-time Free". **Promo watch**: the Flash figures
are 50%-off promotion prices (list ~~0.15 / 0.50~~, cache ~~0.03~~); the promotion ends 2026-09-09
24:00 UTC+8. After that, re-verify and update the Flash row — the same probe pair is the check.

## Green probes (tasks 3.1, 3.2)

Level 1 (opencode alone), same commands as the red probe:

```
glm-5.3-flash: {"cost":0.00286085,"tokens":{"total":38112,"input":38098,"output":4,"reasoning":10,...}}
glm-5.3:       {"cost":0.05333388,"tokens":{"total":38127,"input":37965,"output":5,...,"cache":{"read":128}}}
```

Cost ratio ≈ 18.6× = 1.4/0.075 — each id prices at its **own** rates (D2 verified live).

Level 2 (runner seam): a depth-S scratch run (`priced-route-probe`, one-line doc task) under
`AFK_RUNNER_MODEL=zai-coding-plan/glm-5.3-flash`, read back with
`bun afk-runner/src/cli.ts analyze .afk-runner --json`:

```json
"usage": {
  "byRole": {
    "drafter":    { "inputTokens": 99170,  "outputTokens": 1619, "reasoningTokens": 4090, "cachedReadTokens": 486336, "costUsd": 0.01616004 },
    "reviewer":   { "inputTokens": 79614,  "outputTokens": 2323, "reasoningTokens": 8400, "cachedReadTokens": 644288, "costUsd": 0.01831612 },
    "resolver":   { "inputTokens": 85975,  "outputTokens": 1293, "reasoningTokens": 2774, "cachedReadTokens": 249728, "costUsd": 0.011210795 },
    "decomposer": { "inputTokens": 36527,  "outputTokens": 714,  "reasoningTokens": 565,  "cachedReadTokens": 92224,  "costUsd": 0.004442635 }
  },
  "costKnown": true,
  "unpricedEvents": 0
}
```

Total ≈ **$0.0501** list-rate; the drafter row checks out to the cent against Flash rates including
486,336 cache reads at $0.015/M. The acceptance oracle the proposal names is green: `costKnown: true`
through `usageTotalsOf`/`costSummaryOf`. Probe artifacts (`.afk-runner/`, the probe change folder,
the exclude workaround below) were removed after harvest.

## Reading and rollback (design D3)

The subscription still bills nothing per token — after this edit `done.usage.costUsd` reads **"what
this run would have cost at API rates"** (list-price metering, the claude route's `total_cost_usd`
doctrine). That is the figure the C9 numeric-ceiling drill needs: a real-rate projection crossing a
calibrated ceiling. Rollback: delete the `provider["zai-coding-plan"]` block — one edit; new runs
revert to `costKnown: false`, archived run logs keep their recorded values.

## Incidental finding (out of scope)

The level-2 probe initially died in `guardWorkingTree` (`afk-runner/src/agent-layer.ts:113`): the
CLI's default workdir `.afk-runner/` is **not** gitignored — only the legacy `.sdd-runner/` is
(`.gitignore:68`) — so on a fresh checkout the runner's own bookkeeping (`sessions.jsonl`, sidecars,
transcripts) shows as untracked and the tree guard flags it as agent violations. Worked around for
the probe via `.git/info/exclude` (removed afterwards); the real fix is a one-line `.gitignore`
entry and belongs with the operator-surface robustness follow-up, not here.
