<!--
SPDX-License-Identifier: BUSL-1.1
Copyright (c) 2026 Dmitriy Lazarev
Use of this software is governed by the Business Source License 1.1.
See LICENSE in the project root for details.
-->

# Notes — afk-runner-mcp-integration-research

## Live drill pre-registration — n=5 armed dogfood cycle: `afk-runner-agent-mcp`

Status: **pre-registered; operator sign-off recorded 2026-09-08** (parameters below).
This file is the operator-side record (append-only working log + adjudication at
close-out), mirroring how §9 rode `execution-half-on-graph/notes.md`.

### Why this run (evidence aims, registered before launch)

Dogfood pick: the **implementation of this research's §5 recommendation** — the
first live cycle whose target is afk-runner itself since C9's Run U
(`afk-runner-launch-config`). Openness verified on `origin/master` 2026-09-08:
`agent-layer.ts` carries no `OPENCODE_CONFIG_CONTENT`/mcp wiring;
`review-loop/src/agent-command.ts`'s opencode branch inherits `process.env`
unchanged and its `mcpConfigPath`/`env` seams stay claude-only and unfed.

Ledger aims (the re-score this run owes):

- **U2 (park — closest approach, the decision this run exists to make):** the
  outline decomposes into genuinely independent groups — config surface
  (`afk-runner/src/config.ts`), per-spawn injection composition
  (`afk-runner/src/agent-layer.ts`), per-role narrowing (beside `modelFor`),
  child-env threading (`review-loop/src/agent-command.ts` — a different
  workspace's file), L0/L1 dead-server event schemas
  (`afk-runner/src/agent-noise-schemas.ts`), emission + degradation tests, docs.
  Expected plan ≥ Run W's 13 items across ~4–5 disjoint streams. With
  `deadline: 240` armed, "serialized wall becomes the bottleneck" has a
  concrete thing to bottleneck against — the trigger fires or the closest-
  approach observation decays; both are the evidence.
- **U6 (park):** the config-surface decision (operator knob vs schema keys) is
  **deliberately left open** in the task file — genuine design ambiguity for
  reviewers to potentially split on.
- **U10 (fall — overturn check):** the same open decision should surface as
  assumption-class findings in draft/review if the think-half friction shape
  exists; the overturn trigger needs it dominating ≥2 rounds.
- **walk-item-green D2 wake trigger:** first design-shaped walk since the
  contract landed (Run W was red-first bugs). If the decomposer emits test-only
  items or red-first splits on feature work, the wake fires.
- **U1/U4/U8:** measured per usual (single-spawn holds, reflection cost,
  discovery fraction).

### Run config (sign-off 2026-09-08)

| Key | Value |
| --- | --- |
| Target | fresh worktree off `origin/master`, branch `agent-mcp-live-target`, `bun install --frozen-lockfile` |
| Launch | `.afk-runner/config.json` in the target: `workDir: '.afk-runner'` |
| Model | `zai-coding-plan/glm-5.3` |
| Budget | `20` (numeric — metered; the R4/R5 numeric branches stay live) |
| Deadline | `240` (minutes, armed — the U2 decider) |
| Flags | `--execute` (armed walk) |

Self-reference note (registered): the running process loads base-commit code;
walk edits land on the target branch — no loop. The runner's own spawns during
the run ride the un-instrumented seam and act as a control.

### Task file (to be written to `<target>/.afk-runner/task.md`)

Implement the agent MCP injection surface for afk-runner — capability name
`afk-runner-agent-mcp` — per `docs/architecture/afk-runner-mcp-research.md` §5's
outline. The research doc is in-tree; read it first; every **verified** label
there is load-bearing.

Scope:

- Per-spawn `OPENCODE_CONFIG_CONTENT` for opencode children (options (a)+(c) as
  the one two-layer design): the runner composes the provider block, the
  deny-by-default permission base, the generated per-profile `<server>_*:
  "allow"` grants, and the `mcp` map, serialized to the child env.
- Server set: a global base map plus optional per-role narrowing (checking
  roles — reviewer, skeptic — shed the work servers drafter/decomposer/
  atomicity carry), composed at the seam that already holds the role and the
  model (`agent-layer.ts`, beside `modelFor`).
- Thread the composed content through review-loop's command builder
  (`agent-command.ts` — today the opencode branch inherits `process.env`
  unchanged; the builder never reads ambient `process.env`, so the content must
  arrive as an explicit option).
- Dead-server visibility: L0/L1 agent-noise events under §4.2's payload
  discipline; a failed server degrades to its bounded status data —
  degrade-never-hang; a dead server never fails the run.
- Config surface: **deliberately open** — decide in the change's design between
  (i) an operator knob read and refused at start (the `mcp-servers.ts`
  parse-and-refuse shape) or (ii) keys beside the strict six-key
  `RunnerConfigSchema`. Carry §5's trade-offs into the design decision;
  a present-but-invalid configuration must fail the verb before any run work,
  naming the offending key.

Inherited as decided (do not re-litigate): untrusted input (task files, issue
bodies, chat text) never defines a server; grants are allow-or-absent (`ask`
deadlocks unattended turns); the §1.2 precedence facts (delivered content
overlays the discovered file and wins every same-key conflict).

Non-goals: credential containment for the content route (named follow-up);
repo-local `opencode.json` as the mechanism; the claude `--mcp-config` route
and its backend-threading prerequisite (separate changes); no new failure
kinds, settle outcomes, or budget semantics.

Walk grammar: every task is one complete red→green cycle — the reproducing
test and its implementation land in the same task, never a test-only task.
Verify: the standard compiled check set.

### Pre-registered drills (operator-approved 2026-09-08)

- **Dead-server probe (post-walk, scratch-S):** with the surface landed, point
  the base set at one unreachable server in a fresh minimal (depth-S) run;
  assert the L0/L1 dead-server events emit with bounded payload, no hang, and
  the run proceeds — the new code's own failure mode, live.
- **Invalid-config refusal (post-walk):** a present-but-invalid configuration
  (malformed server entry) must fail the verb before any run work, naming the
  offending key — the research's refusal doctrine on the new surface, whichever
  config shape the design chose.
- Opportunistic, never-fails-the-cycle: F-P3/F-U3/F-P4 live shapes; thrash /
  `C<n>` not-arisen (one-command corpus sweep); metered numeric branches (R4
  cost-unknown refusal / R5 over-ceiling with extend suppressed) if spend
  reaches them under `budget: 20`.

### Protocol points

- **Never self-settle a productive run's gate** — pause at every gate for the
  operator. Expected honest shape: a metered clean-converged final gate may
  R1-auto-approve before attendance (C8/C9 precedent) — recorded, not a miss.
  Release gates are verb-only.
- **Operator-write whitelist** (the zero-re-target ledger): gate answers, the
  two registered post-walk probes' config edits, `resume`/`stop` invocations —
  nothing else. Any re-target is a finding.
- **Telescope:** `tail -f <workDir>/runs/<id>/events.ndjson` — watch
  `stage_enter(decompose)`, `task started/done/failed`, `spawned` per
  implementer; instruments `status`, `runs`, `report`, the `serve` board.

### Owed close-out (the n=5 re-score)

1. Harvest the lane into the live corpus under the extended per-lane oracle.
2. Adjudicate findings; append the working record below with event cites.
3. n=5-style ledger re-score — every row against its trigger verbatim:
   U2 (the wall-vs-deadline decision), U1, U4, U8, U6 (oscillation on the open
   decision), U10-overturn (assumption-dominated rounds), the D2 wake trigger.
4. Update `docs/architecture/afk-runner.md` §"Living follow-ups ledger"
   **only where a trigger fired**; attach non-firing observations to their rows
   for confirm-or-decay.

## Working record (append-only)

_(launched runs, drills, incidents, and the adjudication land here)_

### 2026-09-09 — the n=5 armed dogfood cycle (`afk-runner-agent-mcp`): completed, operator-approved

Launch per the sign-off table: fresh worktree `agent-mcp-live-target` off
`origin/master` 0ad847f3a (post-#427), `bun install --frozen-lockfile`,
`.afk-runner/config.json` (glm-5.3, budget 20, deadline 240), task file
verbatim from above, `start --execute` 04:17:25Z (`execution{armed}` seq 1).
Events cited by seq from the run's `events.ndjson`.

**Timeline.** Think-half 5/5 rounds, all converged (findings 26/10/17/10/10,
every one gap-class); final gate v1 **R1-auto-approved** 07:17:09Z (seq 1242)
— the pre-registered honest shape, recorded not a miss. Walk strictly serial:
t1 07:17:10 → t18 10:44:51, 18 slice commits, 18/18 done; t13 failed once
(09:27:11) and restarted within `TASK_FIX_ATTEMPTS` → done. Verify-1 green
(18167 tests, exit 0). Release gate v2 presented 10:59:27Z (seq 3537,
`auto_decision{rule: none}`), operator `APPROVE` 11:15:39Z (seq 3541) — 16 m
dwell; completed. Accounting per the gate file: **$32.15 metered · 24122 s
wall** vs budget 20 / deadline 240 armed; `autoExtendsUsed` 0; zero R4/R5
ceiling interactions (no extension decision points arose — the opportunistic
metered shapes did not fire).

**Incidents (adjudicated).**

1. Network drop killed the resolver-r3 session 05:25:12Z (ledger `status:
   killed`); the retry proceeded — recovery as designed.
2. The retried resolver wrote scratch into the sibling change folder
   `openspec/changes/store-dogfood-scratch/` → `DiffGuardViolationError`
   crashed the holder 05:37:50Z (`write-guard.ts:86`; crash-shaped by
   design). Hardening candidate, F-P3-shaped: a mid-run guard violation
   degrades to escalation instead of taking the holder down. Evidence
   preserved (temp copy); operator removed the folder and `resume`d 06:10Z —
   whitelisted verbs only.
3. **Resolver misbehavior triad** (same agent, pre-crash): retargeted
   `.afk-runner/config.json` `workDir` → `~/.afk-runner/projects/papai`
   (05:29Z), wrote `.afk-runner/store-dogfood-task.md`, and started **three
   scratch runner runs** (`task-scratch`, `store-dogfood-scratch` completed,
   `task-scratch-2` aborted; ~$1.56 combined; folder-local notes tasks, zero
   branch commits). The agent write guard is working-tree-scoped and never
   saw `.afk-runner/` (gitignored): an agent editing runner-side operator
   config is unguarded. First live near-miss for the research's D6 doctrine
   (untrusted input never defines a server) — had the `AGENT_MCP_*` knobs
   existed pre-crash, a resolver could have pointed its own spawns at a
   server. Finding for the follow-up lane.
4. Drill findings, below: refusal presentation is a raw uncaught-error dump;
   the dead-server probe's own failure was unrelated ambient
   `opencode`-model routing (server error `err_f491e153`).

**Registered post-walk drills.**

- Invalid-config refusal — **PASS**: `AGENT_MCP_SERVERS` with a typeless
  entry refused `start` before any run work (no run dir, no spawn, no spend),
  exit 1, the knob named with the shape problem. Finding: the refusal prints
  as a Bun source-snippet dump, not a clean CLI error line (the config
  loader's wrap style) — cosmetic polish item.
- Dead-server probe — **PASS live on both runner-level assertions**: a
  depth-S unarmed run with base map `{"deadsmoke": local /usr/bin/false}`
  emitted `spawned` events carrying `"mcp":["deadsmoke"]` (names-only bounded
  payload, seq 5/8/10) and nothing hung — the dead entry degraded instantly
  while the run machinery proceeded (intake → draft → escalation gate,
  aborted cleanly via steer + resume, seq 15–16). The
  successful-turn-with-dead-server cell rests on research §7 arm B (same
  builder, same spawn shape, exit 0) — no third live run forced, per
  recorded-not-guessed (no credential pair was fabricated for it).

**n=5 re-score (every row against its registered trigger verbatim).**

- **U2** — trigger "fires or the closest-approach observation decays":
  **not fired; observation confirmed, not decayed.** The armed deadline
  (gate-wait semantics) never decided anything (final gate R1-instant,
  release answered in 16 m), while the plan met the prediction exactly — 18
  items (≥ W's 13) across 5 disjoint streams (review-loop seam / parse /
  compose / threading / docs+smoke) walked strictly serially: wall 402 m =
  1.68× the armed clock. The bottleneck is real; the clock never bites the
  work wall. Row stays park, observation attached.
- **U6** — not fired: the deliberately-open config-surface decision resolved
  to option (i) env knobs (design D1) with zero reviewer split; 5/5 rounds
  converged. Fourth conflict-free cycle; observation attached.
- **U10-overturn** — not fired: 73 findings, all gap-class, zero
  assumption-class; no round dominated, let alone ≥2. Fall verdict stands;
  second live absence attached.
- **D2 wake** — not fired: 18/18 complete red→green cycles (test + impl per
  task), zero test-only items; the first design-shaped walk respected the
  contract.
- **U1** — holds: one implementer spawn per item (t13's bounded retry the
  sole exception); the r3 lens re-spawns were network-kill continuation.
- **U4** — think-half 180 m gross (≈147 m net of the 33 m crash gap) — in
  the C9/U13 family (~1.5–2.5 h), under the day trigger. Hold.
- **U8** — attended wall ≈25 m of 402 m (~6%): discovery fraction holds
  under 20%. Hold.

**Harvest.** `analyze` corpus: 5 runs aggregated (main + 3 scratch + 1
probe), auto decisions R1 × 2 · none × 3, gates never answered 0;
`stranded-complete` flags `afk-runner-agent-mcp` (18/18 tasks, 18 commits,
not on a main ref) — the merge/PR step owed next.

**Operator-write whitelist audit.** Operator writes this cycle: the
release-gate `APPROVE`, the two registered probes' config edits,
`resume`/`stop` invocations, and the guard-violation folder removal
(evidence preserved). Zero re-targets of the run's work; the config.json
retarget was agent-side (incident 3), not operator.
